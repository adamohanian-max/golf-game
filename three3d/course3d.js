// Four Oaks 3D — three.js course renderer. Gated to course id "four-oaks-dracut"
// only (see render3D/update3DMode in game.js); every other course stays on the
// existing 2D canvas path, completely untouched.
//
// This module is render-only. It never touches ball physics, scoring, or input —
// it reads window.GolfBridge (a small accessor object game.js exposes on itself,
// since it's a classic script and this is an ES module — see game.js bottom)
// each frame and places three.js meshes/camera to match. game.js drives us via
// window.Course3D = { init, enter, leave, render, resize, dispose }.
//
// Phase 1: coord bridge + empty scene + a flat ground plane + a tee/pin marker,
// alignment (distance/bearing tee->pin) checked against the 2D view. Done.
// Phase 2: the flat plane replaced by a real mesh displaced per-vertex by
// terrainZ() (same DEM the physics uses) — the hills you see are the hills
// the ball actually rolls on. Done.
// Phase 3: the real NAIP aerial draped over the terrain via the baked
// aerial.toWorld affine (worldToAerialPx below). Done.
// Phase 4: state.ball -> ball mesh every frame (render, below); swipe->launch()
// already worked for free once #game stayed on top and transparent for input
// (see update3DMode in game.js) — this module never touches physics. Camera:
// broadcast fly-cam (chosen over player orbit) — bird's-eye address view of
// the upcoming shot, hard-cuts to a chase view behind the ball the instant
// it's moving, cuts back to a fresh address view the instant it rests
// (updateShotCamera/frameBirdsEye below). Done.
// Gap-closing pass (see ~/.claude/plans/clever-sleeping-corbato.md): user
// compared this against GSPro/TrackMan/Infinite Tees and called it "good,
// needs a lot of work."
// Tier 1 (done): (a) a tiled CC0 turf photo blended into the ground material
// at close camera range (patchGroundDetailShader) — the aerial photo alone is
// ~0.6m/px, fine from broadcast distance, blurry under a chase-cam; (b) a
// real Sky.js + sun-driven directional light + PMREM ambient (buildScene)
// replacing the flat background color + one arbitrary light. Two Sky.js
// gotchas hit and fixed along the way, worth knowing if this gets touched
// again: (1) Sky.js examples default to a huge dome scale (450000) assuming a
// huge camera.far to match — ours didn't, so the dome sat entirely beyond the
// far plane and got clipped from most angles (fine near the horizon, blank
// looking up). Fixed by scaling both together (sky 8000, far 20000). (2) the
// Preetham sky legitimately outputs HDR values (>1.0) near the sun disc —
// three.js defaults to NoToneMapping, which just clips that to flat white
// instead of a glare falloff. Fixed with ACESFilmicToneMapping (init, below) —
// what the official Sky.js example itself pairs it with, for the same reason.
// Tier 2 (current): instanced 3D trees from the WOODS mask (reusing game.js's
// own buildTrees() via GolfBridge.getTrees — see buildTreesForCourse), real
// water via Water.js (buildWaterForCourse), and bunkers as an actual
// depression + sand-texture blend on the terrain (buildTerrainGeometry's
// aBunkerMask + patchGroundDetailShader). GPU-instanced grass blades are
// Tier 3 (deferred — biggest remaining lever, also the biggest mobile-perf
// risk; needs on-device validation first).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { Water } from "three/addons/objects/Water.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const FOUR_OAKS_ID = "four-oaks-dracut";

// Applied to every MeshStandardMaterial in the scene. Root-caused via direct
// testing (nulling scene.environment made shadows suddenly visible): the
// PMREM env map baked from the sky (buildScene) includes the bright sun disc
// itself, so at its default strength (envMapIntensity 1) its image-based
// ambient contribution was swamping the directional light's shadow contrast
// almost entirely — the shadow WAS rendering, just invisible under the flood
// of ambient fill. This keeps the nice direction-aware ambient (a flat
// AmbientLight can't tell a sky-facing slope from a shaded one) without it
// drowning out actual cast shadows.
const ENV_MAP_INTENSITY = 0.25;

// metres per world unit (1 world unit = 3 yd, matches game.js M_PER_UNIT).
// Read from GolfBridge once available; falls back to the known constant so
// worldToScene still works if called before game.js has finished loading.
const M_FALLBACK = 2.7432;
function M() {
  const gb = window.GolfBridge;
  return (gb && gb.M_PER_UNIT) || M_FALLBACK;
}

// ---- coordinate bridge -----------------------------------------------------
// Game world: origin top-left, +x right, +y down, elevation from terrainZ().
// three.js scene: right-handed, Y up, 1 unit = 1 metre.
function worldToScene(x, y, zUnits, out) {
  const m = M();
  out = out || new THREE.Vector3();
  out.set(x * m, (zUnits || 0) * m, y * m);
  return out;
}
function sceneToWorld(v) {
  const m = M();
  return { x: v.x / m, y: v.z / m };
}

// World (game coords) -> screen CSS px through the LIVE camera. game.js's
// wx()/wy() route through this when render3D (view.threeProj) so the 2D gameplay
// layer (cup/ball/aim/contours) draws glued onto the three.js ground — same idea
// as view.appleProj's MapKit pinhole, but the camera is fully known here so it's
// exact (no probe calibration). render() runs before draw() each frame, so the
// camera matrices are already current when game.js calls this.
const _projV = new THREE.Vector3();
function project(x, y, zUnits, out) {
  out = out || {};
  if (!camera) { out.x = 0; out.y = 0; out.inFront = false; return out; }
  worldToScene(x, y, zUnits || 0, _projV);
  _projV.applyMatrix4(camera.matrixWorldInverse); // scene -> view space (camera looks down -z)
  out.inFront = _projV.z < 0;
  _projV.applyMatrix4(camera.projectionMatrix);   // view -> NDC (perspective divide via w)
  out.x = (_projV.x * 0.5 + 0.5) * window.innerWidth;
  out.y = (1 - (_projV.y * 0.5 + 0.5)) * window.innerHeight;
  return out;
}
// Screen CSS px -> world (game coords) on the horizontal ground plane at
// elevation zUnits. For the range finder / taps under render3D.
const _unV = new THREE.Vector3();
function unproject(sx, sy, zUnits) {
  if (!camera) return null;
  const m = M();
  _unV.set((sx / window.innerWidth) * 2 - 1, -((sy / window.innerHeight) * 2 - 1), 0.5).unproject(camera);
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  const dy = _unV.y - oy;
  if (Math.abs(dy) < 1e-6) return null;
  const t = ((zUnits || 0) * m - oy) / dy;
  if (t < 0) return null;
  return { x: (ox + (_unV.x - ox) * t) / m, y: (oz + (_unV.z - oz) * t) / m };
}

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let canvasEl = null;
let initialized = false;
let active = false;      // true while Four Oaks 3D is the live mode
let contextLost = false;

let skirtMesh = null;
let terrainMesh = null;
let terrainMat = null;     // shared with buildGreenPatchesForCourse — same texture/shader, just denser mesh
let greenPatchMeshes = []; // dense per-green overlays — see buildGreenPatchesForCourse
let teeMesh = null;
let pinPoleMesh = null;
let pinFlagMesh = null;
let ballMesh = null;
let sunDir = new THREE.Vector3(0, 1, 0); // set for real in buildScene; shared with water's specular
let sunLight = null; // DirectionalLight — repositioned (not resized) each frame to keep its shadow frustum centered on the camera target

let builtForCourseId = null; // the ground/scene is built once per course (global map)
let treesBuiltForCourseId = null; // separate from builtForCourseId: the WOODS mask can still be decoding the first time buildGroundForCourse runs, so this retries on later syncFromHole calls until it actually gets a tree list
let treeMeshes = [];   // current course's instanced tree meshes, for rebuild/disposal
let waterMeshes = [];  // current course's Water instances, for rebuild/disposal + per-frame time update
let lastFrameT = null; // performance.now() of the previous render(), for water's time uniform

// ---- ground close-up detail (fixes: aerial photo alone is ~0.6m/px, sharp
// from broadcast distance, blurry under a chase-cam/putting view) ----------
let detailTex = null;
function ensureDetailTexture() {
  if (detailTex) return detailTex;
  detailTex = new THREE.TextureLoader().load("three3d/textures/turf_detail.jpg", (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1; // never hardcode — mobile GPUs vary
  });
  return detailTex;
}
let sandTex = null;
function ensureSandTexture() {
  if (sandTex) return sandTex;
  sandTex = new THREE.TextureLoader().load("three3d/textures/sand_detail.jpg", (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  });
  return sandTex;
}

// Patches MeshStandardMaterial via onBeforeCompile (keeps PBR lighting/
// shadows/fog working for free) to fade in a small tiled turf (or sand, where
// the per-vertex aBunkerMask attribute from buildTerrainGeometry says so)
// photo as the camera gets close, fading back to the pure aerial photo at
// broadcast distance — a wide near/far gap avoids a visible "ring" sweeping
// the ground as the camera moves. Detail UV is derived from world-space
// position.xz (metres), NOT the existing aerial-photo UV (that's
// affine-derived from the photo's own pixel grid — tiling it at high repeat
// would stretch/skew).
function patchGroundDetailShader(mat) {
  const tex = ensureDetailTexture();
  const sand = ensureSandTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetailMap = { value: tex };
    shader.uniforms.uSandMap = { value: sand };
    shader.uniforms.uDetailRepeat = { value: 3.0 };  // metres per tile
    shader.uniforms.uBlendNear = { value: 35.0 };    // metres: pure detail texture inside this
    shader.uniforms.uBlendFar = { value: 130.0 };    // metres: pure aerial photo beyond this
    // Unsharp-mask the aerial photo. The baked drape is ~0.56 m/px (NAIP) and
    // goes soft/mushy under a close camera — Apple's imagery stays crisp. A GPU
    // unsharp (recover high-freq edges: cart paths, bunker rims, mowing lines)
    // makes ANY course's aerial read sharper without a higher-res source. Texel
    // size comes from the loaded map's own dimensions (works in GLSL1 — no
    // textureSize()); recomputed on the map-set recompile below.
    shader.uniforms.uSharpAmount = { value: 0.9 };
    shader.uniforms.uMapTexel = { value: new THREE.Vector2(1 / 4096, 1 / 4096) };
    if (mat.map && mat.map.image) {
      shader.uniforms.uMapTexel.value.set(1 / mat.map.image.width, 1 / mat.map.image.height);
    }
    mat.userData.shader = shader; // handle for later live-tuning

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        uniform float uDetailRepeat;
        attribute float aBunkerMask;
        varying vec2 vDetailUv;
        varying float vViewDist;
        varying float vBunkerMask;
      `)
      .replace("#include <begin_vertex>", `
        #include <begin_vertex>
        vDetailUv = position.xz / uDetailRepeat;
        vBunkerMask = aBunkerMask;
      `)
      .replace("#include <project_vertex>", `
        #include <project_vertex>
        vViewDist = -mvPosition.z;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        uniform sampler2D uDetailMap;
        uniform sampler2D uSandMap;
        uniform float uBlendNear;
        uniform float uBlendFar;
        uniform float uSharpAmount;
        uniform vec2 uMapTexel;
        varying vec2 vDetailUv;
        varying float vViewDist;
        varying float vBunkerMask;
      `)
      .replace("#include <map_fragment>", `
        #ifdef USE_MAP
          vec4 _aer = texture2D( map, vMapUv );
          vec3 _blur = (
            texture2D(map, vMapUv + vec2(uMapTexel.x, 0.0)).rgb +
            texture2D(map, vMapUv - vec2(uMapTexel.x, 0.0)).rgb +
            texture2D(map, vMapUv + vec2(0.0, uMapTexel.y)).rgb +
            texture2D(map, vMapUv - vec2(0.0, uMapTexel.y)).rgb) * 0.25;
          // fade the sharpen out with distance so far-field stays mip-smooth
          float _sf = uSharpAmount * (1.0 - smoothstep(120.0, 420.0, vViewDist));
          _aer.rgb = clamp(_aer.rgb + (_aer.rgb - _blur) * _sf, 0.0, 1.0);
          diffuseColor *= _aer;
        #endif
        {
          // CAP the blend at DETAIL_MAX so the aerial (cart paths, bunkers,
          // fairway/green edges) is never fully overwritten by the flat turf
          // tile up close — the old value ramped to 1.0 as the chase camera
          // neared the ground, washing every feature to solid green. The turf
          // now only tints (anti-blur) + adds a small grain; the photo stays
          // visible and the unsharp-mask above keeps it crisp.
          float DETAIL_MAX = 0.45;
          float detailMix = (1.0 - smoothstep(uBlendNear, uBlendFar, vViewDist)) * DETAIL_MAX;
          vec3 turfColor = texture2D(uDetailMap, vDetailUv).rgb;
          vec3 sandColor = texture2D(uSandMap, vDetailUv).rgb;
          vec3 closeColor = mix(turfColor, sandColor, vBunkerMask);
          diffuseColor.rgb = mix(diffuseColor.rgb, closeColor, detailMix);            // light colour tint (<=45%)
          diffuseColor.rgb += (closeColor - vec3(0.5)) * (detailMix * 0.35);          // small micro-texture grain, feature-preserving
          // Nudge bunkers warmer/brighter even at broadcast distance (where
          // detailMix ~0) so they read as sand instead of relying only on
          // whatever the aerial photo happened to capture there.
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.08, 0.85), vBunkerMask * 0.5);
        }
      `);
  };
  mat.needsUpdate = true;
}

function buildScene() {
  scene = new THREE.Scene();

  // Flat fallback behind the Sky mesh below: at some pitch angles (confirmed
  // via the follow-cam right after a shot launches) the Preetham Sky shader
  // washes out to solid white well before the true zenith rather than a
  // gradient — not fully root-caused, but a plain background color showing
  // through underneath is a robust safety net regardless of cause (the Sky
  // mesh renders as normal opaque geometry, so this only shows where it
  // doesn't cover).
  scene.background = new THREE.Color(0xbfd9f2);

  // Physically-plausible sky (Preetham model) instead of a flat color, and a
  // sun direction the sky/directional-light/water(later) all share — one
  // source of truth instead of the old "arbitrary NW-ish" hardcoded vector.
  // Sky.js examples default to a huge scale (450000) assuming a huge camera.far
  // to match. Ours is a small local scene (course is ~2km across); a sky dome
  // that big sits entirely beyond our camera's far plane and gets clipped —
  // renders fine looking toward the horizon (where the near part of the dome
  // is still in range) but shows blank/white looking up at any steeper angle
  // (e.g. the follow-cam right after a shot launches). Scale both together,
  // comfortably inside camera.far below.
  const sky = new Sky();
  sky.scale.setScalar(8000);
  scene.add(sky);

  // Committing hard to one crisp, sunny mood instead of the previous hazy/
  // pale version — per review, a flat/washed-out sky was a big part of why
  // this read as "diagram" rather than "place the sun is actually hitting."
  // Lower turbidity + higher rayleigh = clearer, more saturated blue; a
  // slightly stronger mieDirectionalG keeps a defined (not blown-out, now
  // that ACESFilmic + a lower mieCoefficient tame the glare) sun glow.
  const elevation = 38, azimuth = 200; // degrees — one fixed sunny look for now
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta); // module-level: Water/shadow camera reuse this
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  sky.material.uniforms.turbidity.value = 2.6;
  sky.material.uniforms.rayleigh.value = 3.2;
  sky.material.uniforms.mieCoefficient.value = 0.0022;
  sky.material.uniforms.mieDirectionalG.value = 0.85;

  // The Sky mesh itself isn't fog-affected (three.js fog only applies to normal
  // lit/lambert materials), so the terrain's fogged-out horizon will never
  // perfectly color-match the sky dome behind it — a wider near/far range keeps
  // that seam a gradient instead of a visible line. Pulled nearer than before
  // (was 250-2200) so the mid-distance blur where the aerial photo runs out of
  // real resolution reads as atmospheric haze instead of a naked texture smear
  // — the same trick real-time renderers lean on to hide LOD/texture seams.
  // Fog color matched empirically to the RENDERED sky just above the horizon
  // (sampled ~(228,236,241) after ACES + exposure) — the old 0xbcd8ea tone-
  // mapped to near-neutral white (241,242,242), so fully fogged terrain read
  // as a white sheet against a bluer sky: a visible horizontal band seam in
  // any elevated/low-angle view (e.g. the ball-follow camera after a shot).
  // ACES compresses this hard on its shoulder, so the linear color has to sit
  // noticeably bluer/darker than the target to land on it post-tonemap.
  // Pushed the near plane way out (was 160) so the whole PLAYING area reads
  // crisp instead of veiled — a blue-grey haze creeping onto the mid-fairway
  // was the main reason this looked softer/"washed" than Apple's edge-to-edge
  // sharp imagery. Fog now only does its real job: blending the far horizon
  // into the sky (far pushed to 2100 to match). The aerial-LOD-blur it used to
  // mask past ~130m is covered closer-in by patchGroundDetailShader's turf grain.
  scene.fog = new THREE.Fog(0xa7c8e2, 520, 2100);

  // Ambient dropped from 0.55 -> 0.16: real contrast (a defined lit side and
  // shadow side) is what makes a scene read as "a place the sun is hitting"
  // instead of "flatly lit diagram" — the PMREM env below still supplies
  // direction-aware fill, so this isn't going fully unlit in shadow.
  // Cool-tinted (light bluish, mimicking skylight) against a warm sun below —
  // classic warm-key/cool-fill split reads as outdoor daylight, not a studio.
  scene.add(new THREE.AmbientLight(0xdce8ff, 0.16));
  const sun = new THREE.DirectionalLight(0xfff2da, 2.4); // warm-white key light, notably brighter now that it casts real shadows (see castShadow below)
  sun.position.copy(sunDir).multiplyScalar(500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 1200;
  // Fixed half-extent sized for "whatever's near the camera right now," not
  // the whole 2km course — a shadow frustum that big would spread 2048² texels
  // over the entire map and every shadow would be a blurry smear. Repositioned
  // (not resized) each frame in render() to stay centered under the live
  // camera target, following OrbitControls' own target — see there.
  const SHADOW_HALF = 220;
  sun.shadow.camera.left = -SHADOW_HALF;
  sun.shadow.camera.right = SHADOW_HALF;
  sun.shadow.camera.top = SHADOW_HALF;
  sun.shadow.camera.bottom = -SHADOW_HALF;
  sun.shadow.bias = -0.0012;   // reduces shadow acne on the large flat terrain
  sun.shadow.normalBias = 0.04; // reduces peter-panning/self-shadow noise on thin tree geometry
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target); // DirectionalLight aims at target.position, not a direction vector — must be in the scene graph to take effect
  sunLight = sun; // module-level: render() repositions sun+target together each frame

  // Image-based ambient lighting baked from the sky itself, so slopes facing
  // the sun vs. away from it actually read differently (a flat AmbientLight
  // can't do that regardless of surface orientation). fromScene() renders a
  // cubemap + prefilters mips — expensive; do it ONCE here at build time,
  // never per-frame/per-camera-move.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(sky).texture;
  pmrem.dispose();

  camera = new THREE.PerspectiveCamera(60, 1, 0.5, 20000); // far past the 8000-scale Sky dome above

  controls = new OrbitControls(camera, canvasEl);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  // Phase-1 dev orbit cam only (real flight/address cameras land in phase 10).
  // NOTE: polar angle 90 deg = camera level with the target; Four Oaks' tee/pin
  // elevations are often within a couple metres of each other, i.e. very near
  // 90 deg, so a tight max (e.g. 0.49*PI = 88.2 deg, "just above level") clamps
  // *every* near-level shot and silently re-heights the camera. Leave wide open
  // until real ground collision (phase 2 terrain) gives a reason to clamp.
  controls.maxPolarAngle = Math.PI - 0.05;

  // Phase-1 markers are deliberately oversized (real tee boxes/flagsticks are
  // tiny at a 300m+ hole-length viewing distance) so the bird's-eye alignment
  // shot is legible; scale down to true size once phase 10 brings a golfer's-
  // eye camera close enough that real scale actually reads.
  const teeGeo = new THREE.SphereGeometry(2.2, 16, 12);
  const teeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  teeMat.envMapIntensity = ENV_MAP_INTENSITY;
  teeMesh = new THREE.Mesh(teeGeo, teeMat);
  scene.add(teeMesh);

  const poleMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0 });
  poleMat.envMapIntensity = ENV_MAP_INTENSITY;
  pinPoleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 9, 6), poleMat);
  scene.add(pinPoleMesh);
  // Segmented horizontally (not just 1x1) so the wave-in-wind shader below has
  // vertices to actually bend — a rigid swing (rotating the whole plane) reads
  // as "sign swinging on a hinge," not cloth; per-vertex displacement along
  // the pole-to-tail axis reads as a flag even at this simple a level.
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xe02a25, side: THREE.DoubleSide });
  flagMat.envMapIntensity = ENV_MAP_INTENSITY;
  flagMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    flagMat.userData.shader = shader; // render() ticks uTime through this handle
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        uniform float uTime;
      `)
      .replace("#include <begin_vertex>", `
        #include <begin_vertex>
        // PlaneGeometry(3,2,...) is centered at origin, x in [-1.5, 1.5]. Ramp
        // from 0 at the pole edge (x=-1.5, pinned) to full amplitude at the
        // tail (x=+1.5) so it reads as attached-at-one-edge cloth, not a
        // rigid sign swinging on a center hinge.
        float ramp = (position.x + 1.5) / 3.0;
        float wave = sin(uTime * 6.0 - position.x * 3.0) * ramp * 0.35;
        transformed.z += wave;
      `);
  };
  pinFlagMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 2, 8, 1),
    flagMat
  );
  scene.add(pinFlagMesh);

  const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  ballMat.envMapIntensity = ENV_MAP_INTENSITY;
  ballMesh = new THREE.Mesh(
    // A true 1.68in ball (0.0427m) is a sub-pixel dot from the broadcast/chase
    // camera — exaggerate it (golf-sim convention; the web viewer uses 0.45m).
    new THREE.SphereGeometry(0.4, 16, 12),
    ballMat
  );
  scene.add(ballMesh);
  // The 2D canvas draws the ball now (projected through this camera via
  // view.threeProj), so the aim line/shadow/trail stay consistent with it and
  // the ball is a constant, readable size. Hide the WebGL sphere. (Flag + tee
  // stay WebGL — they read better as real 3D geometry.)
  ballMesh.visible = false;
}

// Terrain mesh sampled straight from terrainZ() (DEM + broad swells + green
// undulation — the exact same function the ball's rollStep uses), so the
// visible hills and the physics ground are the same surface by construction.
// Built in WORLD-grid rows/cols (not three.js PlaneGeometry + rotate, which
// gets confusing to keep in sync with worldToScene) so every vertex's world
// (x,y) is explicit.
// world (x,y) -> aerial pixel (px,py), inverting the baked pixel->world affine
// `[a,b,c,d,e,f]`: wx = a*px + b*py + c, wy = d*px + e*py + f.
function worldToAerialPx(aerial, wx_, wy_) {
  const [a, b, c, d, e, f] = aerial.toWorld;
  const det = a * e - b * d;
  const rx = wx_ - c, ry = wy_ - f;
  return {
    px: (e * rx - b * ry) / det,
    py: (a * ry - d * rx) / det,
  };
}

// `bbox` (world units) + explicit `cols`/`rows` let this same function build
// both the coarse course-wide terrain (default: full world, ~4-unit cells)
// AND small dense patches over an arbitrary sub-rect (used for greens below —
// a green is only ~6-10 world units across, so the coarse mesh gives it 2-3
// vertices total, nowhere near enough to visibly show the real break even
// though terrainZ() already computes it correctly at any point).
function buildTerrainGeometry(aerial, bbox, colsOverride, rowsOverride) {
  const gb = window.GolfBridge;
  const world = gb.getWorld();
  const b = bbox || { minx: 0, miny: 0, maxx: world.w, maxy: world.h };
  const bw = b.maxx - b.minx, bh = b.maxy - b.miny;
  // ~4 world units (~11m) per cell — the raw DEM is ~2 units/cell (105k
  // vertices); this decimates ~4x, still resolves Four Oaks' 55m of relief
  // fine and keeps one course-wide mesh cheap to rebuild/hold on a phone.
  const cols = colsOverride || Math.max(8, Math.round(bw / 4));
  const rows = rowsOverride || Math.max(8, Math.round(bh / 4));
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const uvs = new Float32Array((cols + 1) * (rows + 1) * 2);
  const bunkerMask = new Float32Array((cols + 1) * (rows + 1));
  let p = 0, u = 0, bi = 0;
  for (let j = 0; j <= rows; j++) {
    const wy_ = b.miny + (j / rows) * bh;
    for (let i = 0; i <= cols; i++) {
      const wx_ = b.minx + (i / cols) * bw;
      let z = gb.terrainZ(wx_, wy_);
      // Bunkers as an actual depression, not just whatever the aerial photo
      // shows flush with the fairway. surfaceAt is the same physics-shared
      // classifier the ball's lie uses, so this always agrees with gameplay.
      const isBunker = gb.surfaceAt(wx_, wy_) === "bunker";
      if (isBunker) z -= 0.25; // world units (~0.7m) — tune against screenshots
      bunkerMask[bi++] = isBunker ? 1 : 0;
      const s = worldToScene(wx_, wy_, z);
      positions[p++] = s.x; positions[p++] = s.y; positions[p++] = s.z;
      if (aerial) {
        const { px, py } = worldToAerialPx(aerial, wx_, wy_);
        uvs[u++] = px / aerial.w; uvs[u++] = py / aerial.h;
      } else {
        uvs[u++] = i / cols; uvs[u++] = j / rows;
      }
    }
  }
  const indices = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("aBunkerMask", new THREE.BufferAttribute(bunkerMask, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Ground + everything anchored to the world extent — built once per course
// (Four Oaks is a single connected "global" map shared by all 18 holes).
function buildGroundForCourse() {
  const gb = window.GolfBridge;
  const world = gb.getWorld();
  const course = gb.getCourse();
  const m = M();
  const w = world.w * m, h = world.h * m;

  if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); terrainMesh.material.dispose(); }
  const aerial = course && course.aerial;
  const terrainGeo = buildTerrainGeometry(aerial);
  terrainMat = new THREE.MeshStandardMaterial({ color: 0x4c8a4f, flatShading: false });
  terrainMat.envMapIntensity = ENV_MAP_INTENSITY;
  patchGroundDetailShader(terrainMat);
  terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true; // no castShadow: hillside self-shadowing is a nice-to-have, not worth doubling this mesh's shadow-pass cost for v1
  scene.add(terrainMesh);

  if (aerial) {
    new THREE.TextureLoader().load("courses/" + aerial.file, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;      // our UVs already index rows top-down like the source image
      tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
      terrainMat.map = tex;
      terrainMat.color.set(0xffffff); // let the photo carry color; tint hooks land with the mask (phase 3 polish)
      terrainMat.needsUpdate = true;
    });
  }

  // Flat skirt well below the lowest real terrain, sized way past the world
  // rect: hides the DEM mesh's raw edge (a hard cliff at the world boundary)
  // until phase 7/8 add a sky dome + distance fog to hide the seam properly.
  if (!skirtMesh) {
    const span = Math.max(w, h) * 6;
    const geo = new THREE.PlaneGeometry(span, span, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2f5c34 });
    mat.envMapIntensity = ENV_MAP_INTENSITY;
    skirtMesh = new THREE.Mesh(geo, mat);
    scene.add(skirtMesh);
  }
  let minY = Infinity;
  const posAttr = terrainGeo.getAttribute("position");
  for (let i = 0; i < posAttr.count; i++) minY = Math.min(minY, posAttr.getY(i));
  skirtMesh.position.set(w / 2, minY - 10, h / 2);

  buildWaterForCourse(course);
  buildTreesForCourse(course.id);
  buildBuildingsForCourse(course.id);
  buildGreenPatchesForCourse(aerial);
}

// ---- buildings: extruded OSM footprints ------------------------------------
// The aerial drapes building ROOFS flat onto the ground; Apple shows real
// massing. tools/fetch_buildings.py bakes footprints (world units) + heights to
// courses/buildings/<id>.json; here we extrude each into a lit, shadow-casting
// prism and merge them into one mesh. Course-agnostic: any course with a
// buildings file gets massing; a 404 just skips (vector/unbaked courses).
let buildingMesh = null;
let buildingsBuiltForCourseId = null;
function buildBuildingsForCourse(courseId) {
  if (buildingsBuiltForCourseId === courseId) return;
  buildingsBuiltForCourseId = courseId; // claim now so render()'s retry loop doesn't refetch
  fetch("courses/buildings/" + courseId + ".json")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (buildingMesh) {
        scene.remove(buildingMesh);
        buildingMesh.geometry.dispose();
        buildingMesh.material.dispose();
        buildingMesh = null;
      }
      if (!data || !data.buildings || !data.buildings.length) return;
      const gb = window.GolfBridge;
      const m = M();
      const geos = [];
      for (const b of data.buildings) {
        const poly = b.poly;
        if (!poly || poly.length < 3) continue;
        // centroid (world units) for terrain height + deterministic jitter
        let cx = 0, cy = 0, area2 = 0;
        for (let i = 0; i < poly.length - 1; i++) {
          const cr = poly[i][0] * poly[i + 1][1] - poly[i + 1][0] * poly[i][1];
          area2 += cr;
          cx += (poly[i][0] + poly[i + 1][0]) * cr;
          cy += (poly[i][1] + poly[i + 1][1]) * cr;
        }
        if (Math.abs(area2) < 1e-6) continue;
        cx /= 3 * area2; cy /= 3 * area2;
        const areaM2 = Math.abs(area2 / 2) * m * m;
        const rnd = treeRand(cx, cy);
        // OSM here has no height tags (all default), so vary height so the
        // massing isn't a field of identical boxes, and make big footprints
        // (clubhouse, cart barn) read taller than houses.
        let depth = (b.h || 4.5) * (0.85 + 0.4 * rnd());
        if (areaM2 > 700) depth *= 1.7;
        else if (areaM2 > 300) depth *= 1.3;
        depth = Math.min(depth, 22);
        try {
          const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0] * m, p[1] * m)));
          const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
          // +90deg about X maps footprint (x,y) -> scene (x, *, +y) matching the
          // course convention (scene.z = +world.y*m; verified via debug: tee
          // world (177,505) -> scene z 1385). A -90deg rotation mirrors it to
          // -z, off the course entirely (the bug that hid these).
          geo.rotateX(Math.PI / 2);
          const gy = gb.terrainZ(cx, cy) * m;        // terrain height (metres) at the footprint
          geo.translate(0, gy + depth, 0);           // prism now spans gy .. gy+depth (base on the terrain)
          geos.push(geo);
        } catch (e) { /* skip self-intersecting/degenerate footprints */ }
      }
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      const mat = new THREE.MeshStandardMaterial({
        color: 0xc9b79a, roughness: 0.9, metalness: 0.0, // warm tan — reads as built structure, distinct from grey concrete AND green turf
      });
      mat.envMapIntensity = ENV_MAP_INTENSITY;
      buildingMesh = new THREE.Mesh(merged, mat);
      buildingMesh.castShadow = true;
      buildingMesh.receiveShadow = true;
      scene.add(buildingMesh);
    })
    .catch(() => { /* no buildings file for this course — fine */ });
}

// Dense per-green overlay meshes — same material/texture as the main terrain
// (patchGroundDetailShader already wired onto `terrainMat`), just sampled at
// ~10x the resolution over each green's own small footprint. terrainZ()
// already computes the real break correctly everywhere (confirmed: it folds
// in the synthetic putting-green field the 2D contour/break physics uses) —
// the coarse course-wide mesh just can't SHOW it, since a green (~6-10 world
// units across) only gets 2-3 vertices from a ~4-unit-cell mesh. This is
// purely a visual fix; the ball already breaks correctly either way.
function buildGreenPatchesForCourse(aerial) {
  for (const mesh of greenPatchMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
  greenPatchMeshes = [];
  const gb = window.GolfBridge;
  const hole = gb.getHole();
  const greens = (hole && hole._greens) || [];
  for (const g of greens) {
    if (!g.poly || g.poly.length < 3) continue;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const pt of g.poly) {
      if (pt.x < minx) minx = pt.x; if (pt.x > maxx) maxx = pt.x;
      if (pt.y < miny) miny = pt.y; if (pt.y > maxy) maxy = pt.y;
    }
    const pad = 4; // world units — comfortably inside TUNE.gUndFall's smoothstep, so the seam blends via terrainZ itself rather than a hard edge
    const bbox = { minx: minx - pad, miny: miny - pad, maxx: maxx + pad, maxy: maxy + pad };
    const cellSize = 0.5; // world units (~1.4m) vs. the coarse mesh's 4 — ~8x denser, enough to show 1-3% grades
    const cols = Math.max(6, Math.round((bbox.maxx - bbox.minx) / cellSize));
    const rows = Math.max(6, Math.round((bbox.maxy - bbox.miny) / cellSize));
    const geo = buildTerrainGeometry(aerial, bbox, cols, rows);
    geo.translate(0, 0.03, 0); // tiny lift so it wins depth vs. the coarse mesh underneath instead of z-fighting
    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.receiveShadow = true; // greens near the treeline should visibly sit in shade, not read as floodlit
    scene.add(mesh);
    greenPatchMeshes.push(mesh);
  }
}

// ---- water: real Water.js planar-reflection hazards instead of nothing ----
let waterNormalsTex = null;
function ensureWaterNormalsTexture() {
  if (waterNormalsTex) return waterNormalsTex;
  waterNormalsTex = new THREE.TextureLoader().load("three3d/textures/water_normal.jpg", (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  });
  return waterNormalsTex;
}

function buildWaterForCourse(course) {
  for (const w of waterMeshes) { scene.remove(w); w.geometry.dispose(); w.material.dispose(); }
  waterMeshes = [];
  const gb = window.GolfBridge;
  const polys = (course && course.surfaces && course.surfaces.water) || [];
  if (!polys.length) return;
  const m = M();
  const waterNormals = ensureWaterNormalsTexture();
  for (const poly of polys) {
    if (!poly || poly.length < 3) continue;
    // Shape lives in the plane it's defined in (XY here); rotate flat (XZ)
    // to match how the terrain/skirt planes are built, same worldToScene scale.
    const shape = new THREE.Shape(poly.map((pt) => new THREE.Vector2(pt.x * m, pt.y * m)));
    const geo = new THREE.ShapeGeometry(shape);
    // +90 (not -90): -90 mirrors the footprint to scene -z, off the course, so
    // the reflective water never rendered on the actual pond (only the dark
    // aerial photo showed). scene.z = +world.y*m — see buildings above.
    geo.rotateX(Math.PI / 2);
    let sumZ = 0;
    for (const pt of poly) sumZ += gb.terrainZ(pt.x, pt.y);
    const water = new Water(geo, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals,
      sunDirection: sunDir.clone(),
      sunColor: 0xfff2da, // matches the warm sun light color (buildScene) so the specular glint reads as the same sun
      // Looking DOWN at the pond (broadcast cam) the Fresnel reflection is weak,
      // so the water reads almost entirely as this base color — 0x2f6b74 was too
      // dark and rendered near-black. Lifted to a brighter lit blue so the pond
      // reads as sunlit water (like Apple's) even top-down, while grazing angles
      // still pick up the sky/sun glint on top.
      waterColor: 0x5aa0b4,
      distortionScale: 3.0, // slightly calmer than 3.4 — less busy sparkle on the now-lighter surface
      fog: !!scene.fog,
    });
    water.position.y = (sumZ / poly.length) * m;
    scene.add(water);
    waterMeshes.push(water);
  }
}

// ---- trees: instanced GLTF models placed from the WOODS mask --------------
// Reuses game.js's OWN tree placement (GolfBridge.getTrees -> the exact same
// cached list buildTrees() gives the 2D renderer) rather than re-deriving
// WOODS-cell sampling here — one source of truth for where trees are.
// Procedural "bumpy crown" trees — the Apple-Maps-tree look (a noise-displaced
// icosphere canopy + trunk), replacing the Kenney low-poly CONES. A stand of
// cones reads as cones no matter how you light it — the hard faceted silhouette
// is the problem; a lumpy rounded crown reads as real canopy. Built in code, so
// it needs no GLB/asset and works within the vendored/offline three. Keeps the
// exact {parts,height} shape the old GLB loader returned, so buildTreesForCourse
// is unchanged. (Photoreal octahedral impostors baked from a real tree are the
// next tier up — they need a baked atlas + the impostor/InstancedMesh2 libs
// vendored; this is the no-dependency Apple-mesh-era win.)
let treeSpeciesPromise = null;
function _lumpHash(x, y, z) {
  let s = (Math.imul((x * 127) | 0, 2654435761) ^ Math.imul((y * 311) | 0, 40503) ^
           Math.imul((z * 521) | 0, 668265263)) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0;
  return ((s >>> 8) & 0xffff) / 0xffff;
}
function _makeCrown(radius, tall, lump) {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 - lump + 2 * lump * _lumpHash(v.x * 3, v.y * 3, v.z * 3); // per-vertex radial lumps -> irregular silhouette
    v.multiplyScalar(k);
    v.y *= tall;                                                          // stretch (evergreen vs round)
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox, span = Math.max(0.001, bb.max.y - bb.min.y);
  const bot = new THREE.Color(0x2f5a29), top = new THREE.Color(0x74b04e), col = [];
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / span;                           // dark underside -> lit top (2-tone, the other half of the Apple read)
    const c = bot.clone().lerp(top, 0.15 + 0.85 * t);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}
function loadTreeSpecies() {
  if (treeSpeciesPromise) return treeSpeciesPromise;
  const crownMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  crownMat.envMapIntensity = ENV_MAP_INTENSITY;
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 1, metalness: 0 });
  trunkMat.envMapIntensity = ENV_MAP_INTENSITY;
  // [crownRadius, verticalStretch, lumpAmount, trunkHeight, trunkRadius] (local
  // units — buildTreesForCourse rescales each instance to its real height).
  const arch = [
    [3.1, 1.05, 0.16, 2.2, 0.42], // round deciduous
    [2.5, 1.75, 0.13, 1.7, 0.36], // tall evergreen-ish blob
    [3.7, 0.82, 0.18, 1.9, 0.46], // broad / spreading
    [2.3, 1.02, 0.20, 1.5, 0.34], // small/young (also the bush mesh, species[3])
  ];
  const species = arch.map(([r, tall, lump, trunkH, trunkR]) => {
    const crown = _makeCrown(r, tall, lump);
    crown.translate(0, trunkH + r * tall * 0.6, 0);   // sit crown on the trunk (slight overlap)
    const trunk = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 6, 1);
    trunk.translate(0, trunkH / 2, 0);                // base at y=0
    const height = trunkH + r * tall * 1.6;           // total Y extent (drives per-instance scale)
    return { parts: [{ geometry: crown, material: crownMat }, { geometry: trunk, material: trunkMat }], height };
  });
  treeSpeciesPromise = Promise.resolve(species);
  return treeSpeciesPromise;
}

// Single LOD for now (real meshes at every distance, no billboard swap):
// Four Oaks caps at TUNE.treeMax = 3500 low-poly (7-31KB source) trees
// course-wide, which is cheap to instance outright on any 2020+ mobile GPU.
// A far-distance billboard LOD (reusing game.js's treeSprites() canvases,
// per the plan) is a fast-follow if on-device perf testing ever calls for it.
// Deterministic per-tree PRNG (stable across rebuilds — keyed on world pos, not
// instance index) so a treeline reads as organic variety, not stamped clones.
function treeRand(x, y) {
  let s = (Math.imul(Math.round(x * 8.13) | 0, 374761393) ^
           Math.imul(Math.round(y * 8.13) | 0, 668265263)) >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0;
    return ((s >>> 8) & 0xffffff) / 0x1000000;
  };
}

// Perf caps for the aerial-canopy source (a dense-forest course detects tens of
// thousands of crowns). Instanced low-poly, so these are comfortable on desktop;
// a billboard LOD is the fast-follow for low-end mobile.
const CANOPY_MAX_TREES = 14000;
const CANOPY_MAX_BUSH = 6000;
let _canopyCache = {};   // courseId -> items|null (avoid refetch on render()'s retry)

// Trees must never obscure the target or the ball. Static: drop trees inside a
// green (+margin) or on a tee box (filtered at build). Dynamic: punch a hole in
// the canopy around the LIVE ball each frame (updateTreePunchout) — mirrors the
// 2D renderer's canopy punch-out at ball/cup/green.
const TREE_GREEN_MARGIN = 4.0;  // world units off a green edge kept tree-free
const TREE_TEE_R = 7.0;         // radius around each tee kept tree-free
const TREE_PUNCH_R = 5.5;       // radius around the live ball hidden each frame
function _pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi) inside = !inside;
  }
  return inside;
}
function _dilatePoly(poly, margin) {
  if (!poly || poly.length < 3) return null;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map((p) => {
    const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / d) * margin, y: p.y + (dy / d) * margin };
  });
}

let treesBuildInFlight = false;
function buildTreesForCourse(courseId) {
  if (treesBuildInFlight) return; // render()'s retry calls this every frame until it lands
  const gb = window.GolfBridge;
  treesBuildInFlight = true;
  const canopyP = (courseId in _canopyCache)
    ? Promise.resolve(_canopyCache[courseId])
    : fetch("courses/trees/" + courseId + ".json")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (_canopyCache[courseId] = (j && j.items) ? j.items : null))
        .catch(() => (_canopyCache[courseId] = null));

  Promise.all([loadTreeSpecies(), canopyP]).then(([species, canopy]) => {
    // Build the tree + bush source. Prefer aerial-detected canopy — it's the
    // COMPLETE set (every visible tree/bush incl. lone specimens on open rough),
    // detected from the aerial by tools/detect_canopy.py — over the woods-mask
    // getTrees (capped, misses isolated trees, and this course's mask under-
    // classifies its own forest). Fall back to getTrees where there's no canopy
    // file (or it's still baking).
    let treeItems, bushItems = [];
    if (canopy && canopy.length) {
      const allT = [], allB = [];
      for (const it of canopy) (it.kind === "bush" ? allB : allT).push(it);
      const st = Math.max(1, Math.ceil(allT.length / CANOPY_MAX_TREES));
      const sb = Math.max(1, Math.ceil(allB.length / CANOPY_MAX_BUSH));
      treeItems = []; for (let i = 0; i < allT.length; i += st) treeItems.push(allT[i]);
      for (let i = 0; i < allB.length; i += sb) bushItems.push(allB[i]);
    } else {
      const gt = gb.getTrees() || [];
      if (!gt.length) { treesBuildInFlight = false; return; } // mask decoding — retry next frame
      treeItems = gt.map((t) => ({ x: t.x, y: t.y, h: t.h }));
    }

    // Static exclusion: never place a tree on a green (+margin) or a tee box —
    // it would obscure the putting surface or the shot from the tee.
    const _course = gb.getCourse();
    const _dgreens = (((_course && _course.surfaces && _course.surfaces.green) || []))
      .map((p) => _dilatePoly(p, TREE_GREEN_MARGIN)).filter(Boolean);
    const _tees = (((_course && _course.holes) || [])).map((h) => h.tee).filter(Boolean);
    const _teeR2 = TREE_TEE_R * TREE_TEE_R;
    const _clearOfTarget = (it) => {
      for (const g of _dgreens) if (_pointInPoly(it.x, it.y, g)) return false;
      for (const tp of _tees) { const dx = it.x - tp.x, dy = it.y - tp.y; if (dx * dx + dy * dy < _teeR2) return false; }
      return true;
    };
    treeItems = treeItems.filter(_clearOfTarget);

    treesBuildInFlight = false;
    for (const mesh of treeMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
    treeMeshes = [];
    const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), scaleV = new THREE.Vector3(), eul = new THREE.Euler();

    // ---- trees (by species; deterministic per-position variation) ----
    const bySpecies = species.map(() => []);
    for (const t of treeItems) {
      const sp = (Math.imul(Math.round(t.x * 7.3) | 0, 2654435761) ^ (Math.round(t.y * 7.3) | 0)) >>> 0;
      bySpecies[sp % species.length].push(t);
    }
    for (let s = 0; s < species.length; s++) {
      const list = bySpecies[s];
      if (!list.length) continue;
      const { parts, height } = species[s];
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        inst.castShadow = true; // a cast shadow anchors even cartoon geometry to the ground
        const px = new Float32Array(list.length), py = new Float32Array(list.length);
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          const rnd = treeRand(t.x, t.y);
          // jitter off the detection grid so canopy doesn't read as rows; vary
          // height/crown/yaw/lean so a stand reads organic, not stamped clones.
          const jx = t.x + (rnd() - 0.5) * 2.0, jy = t.y + (rnd() - 0.5) * 2.0;
          const pos = worldToScene(jx, jy, gb.terrainZ(jx, jy));
          const hMul = 0.78 + 0.52 * rnd();
          const wMul = 0.92 + 0.55 * rnd();     // fuller crowns -> clumps merge into a canopy mass (Apple-like)
          const desiredH = (t.h || 4.5) * M() * hMul;
          const scale = desiredH / height;
          scaleV.set(scale * wMul, scale, scale * wMul);
          const yaw = rnd() * Math.PI * 2, lean = (rnd() - 0.5) * 0.16, la = rnd() * Math.PI * 2;
          eul.set(Math.cos(la) * lean, yaw, Math.sin(la) * lean);
          quat.setFromEuler(eul);
          m4.compose(pos, quat, scaleV);
          inst.setMatrixAt(i, m4);
          px[i] = jx; py[i] = jy;
        }
        inst.instanceMatrix.needsUpdate = true;
        _armPunchout(inst, px, py);   // enable the per-frame ball punch-out
        scene.add(inst);
        treeMeshes.push(inst);
      }
    }

    // ---- bushes: low rounded foliage on the ground (aerial-detected scrub).
    // With no canopy file, synthesize a light understory near trees instead. ----
    const bushSp = species[3] || species[species.length - 1];
    if (bushSp) {
      if (!bushItems.length && (!canopy || !canopy.length)) {
        for (const t of treeItems) {
          const rp = treeRand(t.x * 1.7 + 3, t.y * 1.7 - 3);
          const n = rp() < 0.6 ? 1 : 0;
          for (let k = 0; k < n; k++) {
            const a = rp() * Math.PI * 2, d = 2 + 4 * rp();
            bushItems.push({ x: t.x + Math.cos(a) * d, y: t.y + Math.sin(a) * d });
          }
        }
      }
      bushItems = bushItems.filter(_clearOfTarget);
      for (const part of bushSp.parts) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, bushItems.length);
        inst.castShadow = true;
        const px = new Float32Array(bushItems.length), py = new Float32Array(bushItems.length);
        for (let i = 0; i < bushItems.length; i++) {
          const b = bushItems[i];
          const rnd = treeRand(b.x, b.y);
          const jx = b.x + (rnd() - 0.5) * 1.6, jy = b.y + (rnd() - 0.5) * 1.6;
          px[i] = jx; py[i] = jy;
          const pos = worldToScene(jx, jy, gb.terrainZ(jx, jy));
          const hM = 1.1 + 1.6 * rnd();
          const v = hM / bushSp.height;
          const wide = v * (1.4 + 0.7 * rnd());
          scaleV.set(wide, v * 0.9, wide);
          eul.set(0, rnd() * Math.PI * 2, 0);
          quat.setFromEuler(eul);
          m4.compose(pos, quat, scaleV);
          inst.setMatrixAt(i, m4);
        }
        inst.instanceMatrix.needsUpdate = true;
        _armPunchout(inst, px, py);
        scene.add(inst);
        treeMeshes.push(inst);
      }
    }
    treesBuiltForCourseId = courseId;
  }).catch((e) => {
    treesBuildInFlight = false; // let render()'s retry try again next frame
    console.warn("[Course3D] tree build failed:", e);
  });
}

// Stash per-instance world positions + a copy of the base matrices so
// updateTreePunchout can hide/restore instances around the live ball.
function _armPunchout(inst, px, py) {
  inst.userData.px = px;
  inst.userData.py = py;
  inst.userData.base = new Float32Array(inst.instanceMatrix.array);
  inst.userData.hidden = new Uint8Array(px.length);
}

// Hide any tree/bush instance within TREE_PUNCH_R of the live ball so the canopy
// never buries it (mirrors the 2D renderer's ball punch-out). Cheap: a distance
// scan every frame, but the GPU matrix re-upload only fires on frames where the
// hidden SET actually changes (the ball crosses a tree's radius) — rare while
// the ball rests. Only run at rest (see caller) so a shot in flight doesn't
// churn the whole canopy under its ground track.
function updateTreePunchout(bx, by) {
  const R2 = TREE_PUNCH_R * TREE_PUNCH_R;
  for (const mesh of treeMeshes) {
    const px = mesh.userData.px;
    if (!px) continue;
    const py = mesh.userData.py, base = mesh.userData.base, hidden = mesh.userData.hidden;
    const arr = mesh.instanceMatrix.array;
    let changed = false;
    for (let i = 0; i < px.length; i++) {
      const dx = px[i] - bx, dy = py[i] - by;
      const want = (dx * dx + dy * dy) < R2 ? 1 : 0;
      if (want === hidden[i]) continue;
      const o = i * 16;
      if (want) { for (let k = 0; k < 16; k++) arr[o + k] = 0; }        // zero matrix -> not rasterized
      else { for (let k = 0; k < 16; k++) arr[o + k] = base[o + k]; }   // restore
      hidden[i] = want;
      changed = true;
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }
}

// Bound once, ever — init() re-runs this on every context-restore, and without
// this guard each restore stacked another pair of lost/restored listeners on
// canvasEl (permanent, never removed) on top of leaking the prior renderer.
let contextHandlersBound = false;
function markContextHandlers() {
  if (contextHandlersBound) return;
  contextHandlersBound = true;
  canvasEl.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    contextLost = true;
    console.warn("[Course3D] WebGL context lost");
  });
  canvasEl.addEventListener("webglcontextrestored", () => {
    console.warn("[Course3D] WebGL context restored — rebuilding");
    const wasActive = active;
    // Release OrbitControls' own pointer/wheel listeners on canvasEl before
    // init() creates a fresh instance — otherwise the old one is orphaned,
    // doing dead work forever. Do NOT call renderer.dispose() here: the
    // browser already discarded the old GL context and everything tied to
    // it (confirmed via WEBGL_lose_context testing) — dispose() tries to
    // gl.deleteTexture/deleteBuffer/deleteVertexArray those now-stale handles
    // through the canvas's CURRENT (new, post-restore) context, which fires
    // "object does not belong to this context" for every cached resource
    // (100+ warnings on a scene this size). Just drop the reference and let
    // it GC; init() builds an entirely new renderer + re-uploads everything.
    if (controls) controls.dispose();
    renderer = null;
    // Same reasoning as renderer above, one level deeper: syncFromHole(true)
    // below forces buildGroundForCourse()/buildWaterForCourse()/etc. to
    // rebuild from scratch, and each of THOSE guards its rebuild with
    // "if (oldMesh) { ...oldMesh.geometry.dispose()... }" so it doesn't leak
    // GPU memory on a normal (context-alive) rebuild. After a context loss
    // that dispose() is the same stale-context problem all over again — null
    // everything out so each build function sees "nothing built yet" and
    // skips disposing objects whose GPU-side buffers are already gone.
    terrainMesh = null;
    skirtMesh = null;
    waterMeshes = [];
    treeMeshes = [];
    greenPatchMeshes = [];
    contextLost = false;
    initialized = false;
    builtForCourseId = null;
    init();
    active = wasActive;
    syncFromHole(true);
  });
}

function init() {
  if (initialized) return;
  canvasEl = document.getElementById("c3d");
  if (!canvasEl) return;
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The Preetham sky (buildScene, below) legitimately outputs HDR values
  // (>1.0) near the sun disc — real glare. Three.js defaults to NoToneMapping,
  // which just clips anything over 1.0 to flat white instead of rolling it
  // off, which is exactly the "white blowout" the follow-cam showed looking
  // anywhere near the sun. ACESFilmic is what the official Sky.js example
  // pairs it with for this reason.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Bumped from 0.5 -> 0.8: the old value was tuned back when everything was
  // flatly, ambiently lit (no shadows) and needed taming to avoid washing
  // out. Now that the sun casts real shadows (below) the scene has genuine
  // contrast to work with — a darker exposure was reading as "hazy/overcast"
  // per review rather than "sunny," so let more light back in.
  // 0.8 -> 0.92: with the haze pulled back (fog near pushed out in buildScene)
  // the scene was reading a touch dim; a bit more exposure lands the sunny,
  // bright-but-not-blown daylight Apple's imagery has (ACES rolls off the
  // highlights so the sky/sun glare stays controlled).
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  markContextHandlers();
  buildScene();
  resize();
  initialized = true;
}

// Reposition tee/pin/camera for the current hole; (re)build the shared ground
// the first time we see this course. `force` rebuilds the ground even if the
// course id looks unchanged (used after a context-restore).
function syncFromHole(force) {
  const gb = window.GolfBridge;
  if (!gb) return;
  const course = gb.getCourse();
  const hole = gb.getHole();
  if (!course || !hole) return;

  if (force || builtForCourseId !== course.id) {
    buildGroundForCourse();
    builtForCourseId = course.id;
  } else if (treesBuiltForCourseId !== course.id) {
    // Ground already built, but the WOODS mask wasn't ready yet that time
    // (it decodes async) — retry on every hole/enter until it lands.
    buildTreesForCourse(course.id);
  }

  const tee = hole.teePos, pin = hole.holePos;
  const teeH = gb.terrainZ ? gb.terrainZ(tee.x, tee.y) : 0;
  const pinH = gb.terrainZ ? gb.terrainZ(pin.x, pin.y) : 0;

  const teeS = worldToScene(tee.x, tee.y, teeH);
  const pinS = worldToScene(pin.x, pin.y, pinH);

  teeMesh.position.copy(teeS).setY(teeS.y + 2.2);
  pinPoleMesh.position.copy(pinS).setY(pinS.y + 4.5);
  pinFlagMesh.position.copy(pinS).setY(pinS.y + 8);

  camMode = "address";
  frameBirdsEye(teeS, pinS);
}

// Broadcast-style bird's-eye framing between two scene points (both markers
// in frame), used both for the tee->pin address shot and to re-frame after
// each shot settles (ball->pin, i.e. "walk up and see the next shot").
function frameBirdsEye(fromS, toS) {
  const dx = toS.x - fromS.x, dz = toS.z - fromS.z;
  const dist = Math.hypot(dx, dz) || 1;
  const ux = dx / dist, uz = dz / dist; // unit ball->pin (scene x/z)
  // Address view: sit behind AND above the BALL, look down the line just past
  // it, so the ball reads in the lower third with the hole running away to the
  // pin. (Old framing centred on the tee->pin midpoint, which pushed the ball
  // below the bottom edge — you couldn't see your own ball at address.) Floors
  // keep short approach shots from re-framing too close/low.
  const back = Math.max(dist * 0.28, 30), elevate = Math.max(dist * 0.34, 26);
  const look = Math.min(dist * 0.5, dist);
  camera.position.set(fromS.x - ux * back, Math.max(fromS.y, toS.y) + elevate, fromS.z - uz * back);
  controls.target.set(fromS.x + ux * look, (fromS.y + toS.y) / 2, fromS.z + uz * look);
  controls.update();
}

// ---- shot camera: holds a static bird's-eye while the ball is airborne (no
// chase), re-frames ball->pin the moment it settles. ---------------------
let camMode = "address";   // always "address" now — the in-flight follow was removed
let wasMoving = false;
let _lastHoleNum = null;    // reframe to the new tee when this changes (render())

function updateShotCamera() {
  const gb = window.GolfBridge;
  if (!gb) return;
  const st = gb.getState();
  const moving = !!st.moving;
  const b = st.ball;

  if (!moving && wasMoving) {
    // settled: re-frame a bird's-eye toward the pin for the next shot.
    const hole = gb.getHole();
    if (hole) {
      const bh = gb.terrainZ(b.x, b.y);
      const ph = gb.terrainZ(hole.holePos.x, hole.holePos.y);
      camMode = "address";
      frameBirdsEye(worldToScene(b.x, b.y, bh), worldToScene(hole.holePos.x, hole.holePos.y, ph));
    }
  }
  wasMoving = moving;
}

function resize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

function enter() {
  init();
  if (contextLost) return;
  active = true;
  syncFromHole(false);
}

function leave() {
  active = false;
  // Scene/renderer stay alive (Four Oaks is the only 3D course today — cheap to
  // keep resident); real dispose-on-leave lands with multi-course 3D (phase 8).
}

function render() {
  if (!active || !initialized || contextLost) return;
  const now = performance.now();
  const dt = lastFrameT == null ? 1 / 60 : Math.min(0.1, (now - lastFrameT) / 1000);
  lastFrameT = now;
  for (const w of waterMeshes) w.material.uniforms["time"].value += dt;
  const flagShader = pinFlagMesh.material.userData.shader;
  if (flagShader) flagShader.uniforms.uTime.value = now / 1000;

  const gb = window.GolfBridge;
  if (gb) {
    const st = gb.getState();
    const b = st.ball;
    const bh = gb.terrainZ ? gb.terrainZ(b.x, b.y) : 0;
    worldToScene(b.x, b.y, bh + (b.z || 0), ballMesh.position);
    // Keep the ball a visible size at ANY camera distance — a true 4cm ball is a
    // sub-pixel dot from the broadcast/chase cam. Hold a roughly constant small
    // angular size (floored near, capped far) so it never vanishes.
    if (camera) {
      const cd = camera.position.distanceTo(ballMesh.position);
      const r = Math.min(1.8, Math.max(0.45, cd * 0.014));
      ballMesh.scale.setScalar(r / 0.4);  // base SphereGeometry radius is 0.4m
    }
    if (!st.moving) updateTreePunchout(b.x, b.y);  // clear the canopy around the ball at rest
    updateShotCamera();

    // Reframe to the new tee when the hole advances. syncFromHole (which sets
    // camMode="address" + frameBirdsEye(tee->pin) and repositions the markers)
    // otherwise only runs from enter()/context-restore, so after a hole-out the
    // camera would stay framed on the previous hole. Same course -> no rebuild.
    const holeNow = gb.getHole();
    if (holeNow && holeNow.num !== _lastHoleNum) {
      _lastHoleNum = holeNow.num;
      if (!st.moving) syncFromHole(false);
    }

    // Trees retry: the WOODS mask decodes async, and syncFromHole (which
    // calls buildTreesForCourse) only runs once per hole/enter — a player
    // sitting on hole 1 the whole time the mask is still loading would never
    // see trees appear otherwise. Cheap per-frame check (two property reads)
    // mirrors game.js's own drawTrees() guard; buildTreesForCourse itself
    // no-ops once built or mid-build (treesBuildInFlight).
    const courseNow = gb.getCourse();
    if (courseNow && treesBuiltForCourseId !== courseNow.id) {
      const hole = gb.getHole();
      if (hole && hole._mask && hole._mask.lab) buildTreesForCourse(courseNow.id);
    }
  }
  // Shadow frustum is a fixed ~440m box (see buildScene) that follows
  // wherever the camera is actually looking, rather than trying to cover the
  // whole 2km course (which would spread the shadow map's texels too thin to
  // read as anything but a blur). Recentering is just moving a camera
  // transform — cheap enough to do every frame even though it only needs to
  // visibly keep up during the follow-cam chase.
  if (sunLight && controls) {
    sunLight.position.copy(controls.target).addScaledVector(sunDir, 500);
    sunLight.target.position.copy(controls.target);
  }
  controls.update();
  renderer.render(scene, camera);
}

function dispose() {
  if (renderer) renderer.dispose();
  for (const w of waterMeshes) { w.geometry.dispose(); w.material.dispose(); }
  for (const t of treeMeshes) t.geometry.dispose();
  for (const g of greenPatchMeshes) g.geometry.dispose(); // shares terrainMat — don't dispose the material twice
  waterMeshes = [];
  treeMeshes = [];
  greenPatchMeshes = [];
  treesBuiltForCourseId = null;
  initialized = false;
  active = false;
  builtForCourseId = null;
}

window.Course3D = {
  init, enter, leave, render, resize, dispose, FOUR_OAKS_ID, worldToScene, sceneToWorld, project, unproject,
  debug: () => {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const q = camera.quaternion;
    return {
      camPos: camera.position.toArray(), camUp: camera.up.toArray(), camDir: dir.toArray(),
      camQuat: [q.x, q.y, q.z, q.w], camRotZ: camera.rotation.z,
      target: controls.target.toArray(), teePos: teeMesh.position.toArray(),
      pinPos: pinPoleMesh.position.toArray(), skirtPos: skirtMesh.position.toArray(),
      terrainVerts: terrainMesh.geometry.getAttribute("position").count,
      aspect: camera.aspect, fov: camera.fov,
      treeInstancedMeshes: treeMeshes.length,
      treeInstancesTotal: treeMeshes.reduce((s, m) => s + m.count, 0),
      treesBuiltForCourseId, waterMeshCount: waterMeshes.length, greenPatchCount: greenPatchMeshes.length,
      shadowMapEnabled: renderer.shadowMap.enabled, sunCastShadow: sunLight && sunLight.castShadow,
      sunPos: sunLight && sunLight.position.toArray(), sunTargetPos: sunLight && sunLight.target.position.toArray(),
      treeCastShadow: treeMeshes.length ? treeMeshes[0].castShadow : null,
      terrainReceiveShadow: terrainMesh && terrainMesh.receiveShadow,
    };
  },
};
