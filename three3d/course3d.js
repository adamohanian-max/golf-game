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
let teeMesh = null;
let pinPoleMesh = null;
let pinFlagMesh = null;
let ballMesh = null;
let sunDir = new THREE.Vector3(0, 1, 0); // set for real in buildScene; shared with water's specular

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

  const elevation = 35, azimuth = 200; // degrees — one fixed sunny look for now
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta); // module-level: Water reuses this for its specular
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  sky.material.uniforms.turbidity.value = 4;
  sky.material.uniforms.rayleigh.value = 2.2;
  sky.material.uniforms.mieCoefficient.value = 0.003;
  sky.material.uniforms.mieDirectionalG.value = 0.8;

  // The Sky mesh itself isn't fog-affected (three.js fog only applies to normal
  // lit/lambert materials), so the terrain's fogged-out horizon will never
  // perfectly color-match the sky dome behind it — a wider near/far range keeps
  // that seam a gradient instead of a visible line.
  scene.fog = new THREE.Fog(0xcfe3f5, 250, 2200);

  // Ambient dropped from 0.55 -> 0.25: the PMREM env below now supplies most
  // of the non-directional fill, so a flat ambient on top of it would wash
  // the shading out and flatten the rolling terrain again.
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.copy(sunDir).multiplyScalar(500);
  scene.add(sun);

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
  teeMesh = new THREE.Mesh(teeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
  scene.add(teeMesh);

  pinPoleMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 9, 6),
    new THREE.MeshStandardMaterial({ color: 0xf4f4f0 })
  );
  scene.add(pinPoleMesh);
  pinFlagMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 2),
    new THREE.MeshStandardMaterial({ color: 0xe02a25, side: THREE.DoubleSide })
  );
  scene.add(pinFlagMesh);

  ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.0427, 12, 10), // real 1.68in golf ball radius, in metres
    new THREE.MeshStandardMaterial({ color: 0xffffff })
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

function buildTerrainGeometry(aerial) {
  const gb = window.GolfBridge;
  const world = gb.getWorld();
  // ~4 world units (~11m) per cell — the raw DEM is ~2 units/cell (105k
  // vertices); this decimates ~4x, still resolves Four Oaks' 55m of relief
  // fine and keeps one course-wide mesh cheap to rebuild/hold on a phone.
  const cols = Math.max(8, Math.round(world.w / 4));
  const rows = Math.max(8, Math.round(world.h / 4));
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const uvs = new Float32Array((cols + 1) * (rows + 1) * 2);
  const bunkerMask = new Float32Array((cols + 1) * (rows + 1));
  let p = 0, u = 0, bi = 0;
  for (let j = 0; j <= rows; j++) {
    const wy_ = (j / rows) * world.h;
    for (let i = 0; i <= cols; i++) {
      const wx_ = (i / cols) * world.w;
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
  const terrainMat = new THREE.MeshStandardMaterial({ color: 0x4c8a4f, flatShading: false });
  patchGroundDetailShader(terrainMat);
  terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
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
    skirtMesh = new THREE.Mesh(geo, mat);
    scene.add(skirtMesh);
  }
  let minY = Infinity;
  const posAttr = terrainGeo.getAttribute("position");
  for (let i = 0; i < posAttr.count; i++) minY = Math.min(minY, posAttr.getY(i));
  skirtMesh.position.set(w / 2, minY - 10, h / 2);

  buildWaterForCourse(course);
  buildTreesForCourse(course.id);
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
      sunColor: 0xffffff,
      waterColor: 0x1e4a52,
      distortionScale: 2.2,
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
function buildTreesForCourse(courseId) {
  const gb = window.GolfBridge;
  const trees = gb.getTrees();
  if (!trees.length) return; // WOODS mask may still be decoding — syncFromHole retries this on the next hole/enter
  loadTreeSpecies().then((species) => {
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
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          const th = gb.terrainZ(t.x, t.y);
          const pos = worldToScene(t.x, t.y, th);
          const desiredH = t.h * M(); // world units -> metres
          const scale = desiredH / height;
          scaleV.set(scale, scale, scale);
          quat.setFromEuler(new THREE.Euler(0, i * 2.399963, 0)); // golden-angle-ish, deterministic per-instance variety
          m4.compose(pos, quat, scaleV);
          inst.setMatrixAt(i, m4);
        }
        inst.instanceMatrix.needsUpdate = true;
        scene.add(inst);
        treeMeshes.push(inst);
      }
    }
    treesBuiltForCourseId = courseId;
  });
}

function markContextHandlers() {
  canvasEl.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    contextLost = true;
    console.warn("[Course3D] WebGL context lost");
  });
  canvasEl.addEventListener("webglcontextrestored", () => {
    console.warn("[Course3D] WebGL context restored — rebuilding");
    contextLost = false;
    initialized = false;
    builtForCourseId = null;
    init();
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
  renderer.toneMappingExposure = 0.5;
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

  const gb = window.GolfBridge;
  if (gb) {
    const b = gb.getState().ball;
    const bh = gb.terrainZ ? gb.terrainZ(b.x, b.y) : 0;
    worldToScene(b.x, b.y, bh + (b.z || 0), ballMesh.position);
    updateShotCamera();
  }
  controls.update();
  renderer.render(scene, camera);
}

function dispose() {
  if (renderer) renderer.dispose();
  for (const w of waterMeshes) { w.geometry.dispose(); w.material.dispose(); }
  for (const t of treeMeshes) t.geometry.dispose();
  waterMeshes = [];
  treeMeshes = [];
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
      treesBuiltForCourseId, waterMeshCount: waterMeshes.length,
    };
  },
};
