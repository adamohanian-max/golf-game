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
        varying vec2 vDetailUv;
        varying float vViewDist;
        varying float vBunkerMask;
      `)
      .replace("#include <map_fragment>", `
        #include <map_fragment>
        {
          float detailMix = 1.0 - smoothstep(uBlendNear, uBlendFar, vViewDist);
          vec3 turfColor = texture2D(uDetailMap, vDetailUv).rgb;
          vec3 sandColor = texture2D(uSandMap, vDetailUv).rgb;
          vec3 closeColor = mix(turfColor, sandColor, vBunkerMask);
          diffuseColor.rgb = mix(diffuseColor.rgb, closeColor, detailMix);
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
  scene.fog = new THREE.Fog(0xa7c8e2, 160, 1700);

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
    new THREE.SphereGeometry(0.0427, 12, 10), // real 1.68in golf ball radius, in metres
    ballMat
  );
  scene.add(ballMesh);
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
  buildGreenPatchesForCourse(aerial);
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
    geo.rotateX(-Math.PI / 2);
    let sumZ = 0;
    for (const pt of poly) sumZ += gb.terrainZ(pt.x, pt.y);
    const water = new Water(geo, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals,
      sunDirection: sunDir.clone(),
      sunColor: 0xfff2da, // matches the warm sun light color (buildScene) so the specular glint reads as the same sun
      waterColor: 0x2f6b74, // lighter than before — was reading as a flat dark blob; needs headroom to show the sky/sun glint
      distortionScale: 3.4, // more visible ripple — was too calm to read as "wet" from a distance
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
const TREE_MODEL_FILES = [
  "three3d/models/trees/tree_oak.glb",
  "three3d/models/trees/tree_detailed.glb",
  "three3d/models/trees/tree_pine_tall.glb",
  "three3d/models/trees/tree_pine_round.glb",
];
let treeSpeciesPromise = null;
function loadTreeSpecies() {
  if (treeSpeciesPromise) return treeSpeciesPromise;
  const loader = new GLTFLoader();
  treeSpeciesPromise = Promise.all(TREE_MODEL_FILES.map((url) => new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      const parts = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        // Kenney's flat-color low-poly palette (bright teal-green foliage) reads
        // as a cartoon cutout against the photoreal aerial terrain — pull it
        // toward duller, more natural tones. Leaf vs. bark told apart by which
        // channel dominates (green vs. red/brown); works without per-species
        // material names.
        const c = o.material.color;
        if (c) {
          if (c.g >= c.r && c.g >= c.b) c.lerp(new THREE.Color(0x355e2a), 0.85); // foliage -> natural forest green
          else c.lerp(new THREE.Color(0x53422c), 0.7);                          // bark -> muted brown
          o.material.roughness = 1;
          o.material.metalness = 0;
          o.material.envMapIntensity = ENV_MAP_INTENSITY;
        }
        parts.push({ geometry: o.geometry, material: o.material });
      });
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const height = Math.max(0.01, box.max.y - box.min.y);
      resolve({ parts, height });
    }, undefined, reject);
  })));
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

let treesBuildInFlight = false;
function buildTreesForCourse(courseId) {
  if (treesBuildInFlight) return; // already mid-build for this attempt — render()'s retry calls this every frame until it lands
  const gb = window.GolfBridge;
  const trees = gb.getTrees();
  if (!trees.length) return; // WOODS mask may still be decoding — render()'s per-frame retry (mirrors game.js's own drawTrees() guard) picks it up the instant it's ready
  treesBuildInFlight = true;
  loadTreeSpecies().then((species) => {
    treesBuildInFlight = false;
    for (const mesh of treeMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
    treeMeshes = [];
    const bySpecies = species.map(() => []);
    for (const t of trees) bySpecies[t.s % species.length].push(t);
    const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), scaleV = new THREE.Vector3();
    for (let s = 0; s < species.length; s++) {
      const list = bySpecies[s];
      if (!list.length) continue;
      const { parts, height } = species[s];
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        // Per the aesthetics review: a cast shadow anchors even simple/cartoon
        // tree geometry to the ground far more convincingly than any texture
        // change would — real light interacting with the object, not just
        // being lit by it. No receiveShadow: trees shadowing other trees
        // isn't worth the cost for this pass.
        inst.castShadow = true;
        const eul = new THREE.Euler();
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          const th = gb.terrainZ(t.x, t.y);
          const pos = worldToScene(t.x, t.y, th);
          // Real forests aren't cloned lollipops — jitter each tree's height,
          // crown width (independent of height), yaw, and give a slight lean so
          // a treeline reads organic instead of a stamped row. Deterministic per
          // world position so it's stable across rebuilds (setColorAt-free — no
          // per-instance material cost).
          const rnd = treeRand(t.x, t.y);
          const hMul = 0.78 + 0.52 * rnd();     // height 0.78-1.30x
          const wMul = 0.80 + 0.40 * rnd();     // crown width 0.80-1.20x, independent of height
          const desiredH = t.h * M() * hMul;    // world units -> metres
          const scale = desiredH / height;
          scaleV.set(scale * wMul, scale, scale * wMul);
          const yaw = rnd() * Math.PI * 2;      // full random spin (was golden-angle by index)
          const lean = (rnd() - 0.5) * 0.16;    // small tilt off vertical
          const leanAz = rnd() * Math.PI * 2;
          eul.set(Math.cos(leanAz) * lean, yaw, Math.sin(leanAz) * lean);
          quat.setFromEuler(eul);
          m4.compose(pos, quat, scaleV);
          inst.setMatrixAt(i, m4);
        }
        inst.instanceMatrix.needsUpdate = true;
        scene.add(inst);
        treeMeshes.push(inst);
      }
    }
    treesBuiltForCourseId = courseId;
  }).catch((e) => {
    treesBuildInFlight = false; // let render()'s retry try again next frame instead of getting stuck forever
    console.warn("[Course3D] tree model load failed:", e);
  });
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
  renderer.toneMappingExposure = 0.8;
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
  const midX = (fromS.x + toS.x) / 2, midZ = (fromS.z + toS.z) / 2, midY = (fromS.y + toS.y) / 2;
  // Floors keep short approach shots (ball already close to the pin) from
  // re-framing into an awkward too-close, too-low shot.
  const back = Math.max(dist * 0.4, 28), elevate = Math.max(dist * 0.25, 18);
  camera.position.set(midX - (dx / dist) * back, midY + elevate, midZ - (dz / dist) * back);
  controls.target.set(midX, midY, midZ);
  controls.update();
}

// ---- broadcast fly-cam: chases the ball while it's moving, re-frames a
// bird's-eye of ball->pin the moment it settles (phase 4/10). ------------
let camMode = "address";   // "address" (static bird's-eye) | "follow" (chasing the shot)
let wasMoving = false;
let followDir = { x: 0, y: -1 }; // world-space unit vector the camera trails behind

function updateShotCamera() {
  const gb = window.GolfBridge;
  if (!gb) return;
  const st = gb.getState();
  const moving = !!st.moving;
  const b = st.ball;

  if (moving && !wasMoving) {
    // shot just launched: trail from the ball's own velocity if it's already
    // nonzero, else (first physics tick hasn't run yet) fall back to the
    // ball->pin direction so the cut isn't facing backwards.
    const hole = gb.getHole();
    let dx = b.vx, dy = b.vy;
    if (Math.hypot(dx, dy) < 1e-4 && hole) { dx = hole.holePos.x - b.x; dy = hole.holePos.y - b.y; }
    const d = Math.hypot(dx, dy) || 1;
    followDir = { x: dx / d, y: dy / d };
    camMode = "follow";
  }
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

  if (camMode === "follow") {
    const bh = gb.terrainZ(b.x, b.y);
    const ballS = worldToScene(b.x, b.y, bh + (b.z || 0));
    const m = M();
    const behind = 16, up = 7;
    const targetPos = new THREE.Vector3(
      ballS.x - followDir.x * m * behind,
      ballS.y + up,
      ballS.z - followDir.y * m * behind
    );
    camera.position.lerp(targetPos, 0.1);
    controls.target.lerp(ballS, 0.25);
  }
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
    const b = gb.getState().ball;
    const bh = gb.terrainZ ? gb.terrainZ(b.x, b.y) : 0;
    worldToScene(b.x, b.y, bh + (b.z || 0), ballMesh.position);
    updateShotCamera();

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
  init, enter, leave, render, resize, dispose, FOUR_OAKS_ID, worldToScene, sceneToWorld,
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
