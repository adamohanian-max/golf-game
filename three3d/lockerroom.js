// ============================================================
//  Locker-room home menu — real three.js 3D scene.
//
//  A box clubhouse room the player stands inside: wood walls, a
//  floor, a bank of four lockers whose doors hinge open on a real
//  axis, warm lights + shadows. Tapping a door swings it open, then
//  fires that menu's action (the same global handlers the old DOM
//  buttons called). On first launch a cinematic camera dolly-in
//  plays (lights bloom on); later visits land settled.
//
//  Mirrors the window.Course3D pattern (three3d/course3d.js): an ES
//  module exposing a global object, so the classic-script game.js can
//  drive it. Own dedicated canvas (#clocker) + renderer — does NOT
//  touch #c3d, which Course3D owns. Ticked by game.js's loop via
//  window.LockerRoom.render() while mode === "menu".
// ============================================================

import * as THREE from "three";

const DOOR_TEX_URL = "assets/locker/wood-door.png";

// Menu actions, left→right. `fn` names a global function defined in game.js.
const DOORS = [
  { label: "Play",    fn: "openPlayMenu" },
  { label: "Daily",   fn: "startDaily" },
  { label: "Range",   fn: "startRange" },
  { label: "Account", fn: "openAccountViewer" },
];

// ---- room dimensions (metres) ----
const ROOM_W = 8.0, ROOM_H = 3.1, ROOM_D = 9.4;
const WALL_Z = -ROOM_D / 2;             // back wall (lockers live here)
const DOOR_W = 0.82, DOOR_H = 2.0, DOOR_T = 0.07;
const DOOR_GAP = 0.18;
const DOOR_BOTTOM = 0.42;               // sits above the bench/base
const OPEN_ANGLE = -Math.PI * 0.62;     // hinge swing when open

// ---- module singletons ----
let renderer = null, scene = null, camera = null, canvasEl = null;
let initialized = false, active = false, initFailed = false;
let doorMeshes = [];                     // interactive door faces (for raycast)
let keyLight = null, ambLight = null, ceilLight = null, signMat = null;
let raycaster = null;
const pointerNDC = new THREE.Vector2();

// camera ease targets
const camPos = new THREE.Vector3();
const camTargetPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camTargetLook = new THREE.Vector3();
let lastT = null;
let lightLevel = 1;      // 0..1, eased toward lightTarget (dolly bloom)
let lightTarget = 1;

const SETTLED_POS = new THREE.Vector3(0, 1.5, 3.2);
const SETTLED_LOOK = new THREE.Vector3(0, 1.4, WALL_Z + 0.42);

function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// ---- build ----------------------------------------------------------------
function woodMat(hex, rough) {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: rough == null ? 0.85 : rough, metalness: 0.05 });
}

function buildRoom() {
  const wallMat = woodMat(0x4a3320, 0.92);
  const trimMat = woodMat(0x2e2013, 0.9);

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W + 4, ROOM_D + 4), woodMat(0x2a1d12, 0.95));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ceiling
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W + 4, ROOM_D + 4), woodMat(0x1a130c, 1));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ROOM_H;
  scene.add(ceil);

  // back wall
  const back = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), wallMat);
  back.position.set(0, ROOM_H / 2, WALL_Z);
  back.receiveShadow = true;
  scene.add(back);

  // side walls
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), wallMat);
    w.rotation.y = -sx * Math.PI / 2;
    w.position.set(sx * ROOM_W / 2, ROOM_H / 2, 0);
    w.receiveShadow = true;
    scene.add(w);
  }

  // green bench across the front-ish
  const bench = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W * 0.62, 0.4, 0.7), new THREE.MeshStandardMaterial({ color: 0x1f5e3a, roughness: 0.7 }));
  bench.position.set(0, 0.2, WALL_Z + 2.4);
  bench.castShadow = true; bench.receiveShadow = true;
  scene.add(bench);

  // locker base cabinet — kept BEHIND the door faces (doors sit at WALL_Z+0.42,
  // front ~-3.045; this front face must stay deeper than that or it occludes them)
  const bankW = DOORS.length * DOOR_W + (DOORS.length - 1) * DOOR_GAP + 0.3;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(bankW, DOOR_H + 0.5, 0.24), trimMat);
  cab.position.set(0, DOOR_BOTTOM + DOOR_H / 2 - 0.05, WALL_Z + 0.12);
  cab.castShadow = true; cab.receiveShadow = true;
  scene.add(cab);
}

// One CanvasTexture per door: the wood-door art with its menu label
// composited over the brass placard (in Fraunces gold).
function makeDoorTexture(img, label) {
  const cw = 512, ch = Math.round(cw * (img.height / img.width));
  const cv = document.createElement("canvas");
  cv.width = cw; cv.height = ch;
  const c = cv.getContext("2d");
  c.drawImage(img, 0, 0, cw, ch);
  // placard band ~31.5%..39.5% of the door height, inset 16% sides
  const px = cw * 0.16, pw = cw * 0.68;
  const py = ch * 0.315, ph = ch * 0.075;
  const g = c.createLinearGradient(0, py, 0, py + ph);
  g.addColorStop(0, "#f0d79a"); g.addColorStop(0.55, "#cfa85e"); g.addColorStop(1, "#b08d4a");
  c.fillStyle = g;
  c.fillRect(px, py, pw, ph);
  c.fillStyle = "#3a2708";
  c.textAlign = "center"; c.textBaseline = "middle";
  c.font = `700 ${Math.round(ph * 0.62)}px Fraunces, Georgia, serif`;
  c.fillText(label, cw / 2, py + ph / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function buildDoors(img) {
  const n = DOORS.length;
  const bankW = n * DOOR_W + (n - 1) * DOOR_GAP;
  const startX = -bankW / 2;
  const sideMat = woodMat(0x3a2817, 0.9);
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0x0a0705, roughness: 1 });

  DOORS.forEach((d, i) => {
    const leftX = startX + i * (DOOR_W + DOOR_GAP);

    // dark interior recess (behind the door)
    const rec = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W - 0.04, DOOR_H - 0.04, 0.35), interiorMat);
    rec.position.set(leftX + DOOR_W / 2, DOOR_BOTTOM + DOOR_H / 2, WALL_Z + 0.06);
    scene.add(rec);

    // hinge pivot group at the door's LEFT edge
    const hinge = new THREE.Group();
    hinge.position.set(leftX, DOOR_BOTTOM + DOOR_H / 2, WALL_Z + 0.42);
    scene.add(hinge);

    const frontMat = new THREE.MeshStandardMaterial({ map: makeDoorTexture(img, d.label), roughness: 0.72, metalness: 0.02 });
    // BoxGeometry face order: +x,-x,+y,-y,+z,-z  → front = +z
    const mats = [sideMat, sideMat, sideMat, sideMat, frontMat, sideMat];
    const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, DOOR_T), mats);
    door.position.set(DOOR_W / 2, 0, 0);   // shift so the group origin is the left hinge
    door.castShadow = true; door.receiveShadow = true;
    hinge.add(door);

    hinge.userData = { angle: 0, target: 0, action: d.fn, fired: false };
    door.userData.hinge = hinge;
    doorMeshes.push(door);
  });
}

function buildSign() {
  const cw = 1024, ch = 320;
  const cv = document.createElement("canvas");
  cv.width = cw; cv.height = ch;
  const c = cv.getContext("2d");
  c.textAlign = "center"; c.textBaseline = "middle";
  c.font = "700 200px Fraunces, Georgia, serif";
  const g = c.createLinearGradient(0, 40, 0, ch - 20);
  g.addColorStop(0, "#f7e1a6"); g.addColorStop(0.5, "#cfa85e"); g.addColorStop(1, "#a9823f");
  c.fillStyle = g;
  c.shadowColor = "rgba(207,168,94,0.6)"; c.shadowBlur = 26;
  c.fillText("Yo Golf", cw / 2, ch / 2 + 8);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  signMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8 * ch / cw), signMat);
  sign.position.set(0, DOOR_BOTTOM + DOOR_H + 0.42, WALL_Z + 0.08);
  scene.add(sign);
}

function buildLights() {
  ambLight = new THREE.AmbientLight(0xffe6c2, 0.42);
  scene.add(ambLight);

  keyLight = new THREE.DirectionalLight(0xfff0d6, 1.7);
  keyLight.position.set(1.6, ROOM_H + 1.5, ROOM_D * 0.4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 22;
  keyLight.shadow.camera.left = -5; keyLight.shadow.camera.right = 5;
  keyLight.shadow.camera.top = 5; keyLight.shadow.camera.bottom = -5;
  keyLight.shadow.bias = -0.0004;
  scene.add(keyLight);
  scene.add(keyLight.target);
  keyLight.target.position.set(0, 1, WALL_Z);

  ceilLight = new THREE.PointLight(0xffd9a0, 18, 12, 2);
  ceilLight.position.set(0, ROOM_H - 0.2, 1.2);
  scene.add(ceilLight);
}

function loadDoorImageThen(cb) {
  const img = new Image();
  img.onload = () => cb(img);
  img.onerror = () => { initFailed = true; };
  img.src = DOOR_TEX_URL;
}

// ---- lifecycle ------------------------------------------------------------
function init() {
  if (initialized || initFailed) return;
  canvasEl = document.getElementById("clocker");
  if (!canvasEl) { initFailed = true; return; }
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: "high-performance" });
  } catch (e) { initFailed = true; return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120b06);
  scene.fog = new THREE.Fog(0x120b06, ROOM_D * 0.9, ROOM_D * 2.4);

  camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 100);
  camPos.copy(SETTLED_POS); camLook.copy(SETTLED_LOOK);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  raycaster = new THREE.Raycaster();

  buildRoom();
  buildSign();
  buildLights();

  // Doors + labels need the art (and the font) before baking textures.
  const build = () => loadDoorImageThen((img) => buildDoors(img));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build); else build();

  canvasEl.addEventListener("pointerdown", onPointerDown);
  resize();
  initialized = true;
}

// returns true if the 3D room is live (so game.js can toggle body.locker3d)
function enter(firstLaunch) {
  init();
  if (initFailed || !initialized) return false;
  active = true;
  // reset doors closed
  doorMeshes.forEach((d) => { const h = d.userData.hinge; h.userData.angle = 0; h.userData.target = 0; h.userData.fired = false; h.rotation.y = 0; });
  lastT = null;
  if (firstLaunch && !reducedMotion()) {
    // dolly-in from further back + low, lights bloom up
    camPos.set(0, 1.2, 4.4);
    camLook.set(0, 1.3, WALL_Z + 0.42);
    camera.position.copy(camPos);
    lightLevel = 0.12; lightTarget = 1;
  } else {
    camPos.copy(SETTLED_POS); camLook.copy(SETTLED_LOOK);
    camera.position.copy(camPos);
    lightLevel = 1; lightTarget = 1;
  }
  camTargetPos.copy(SETTLED_POS);
  camTargetLook.copy(SETTLED_LOOK);
  applyLights();
  return true;
}

function leave() { active = false; }

function applyLights() {
  if (ambLight) ambLight.intensity = 0.10 + 0.32 * lightLevel;
  if (keyLight) keyLight.intensity = 0.15 + 1.55 * lightLevel;
  if (ceilLight) ceilLight.intensity = 2 + 16 * lightLevel;
  if (signMat) signMat.opacity = 0.15 + 0.85 * lightLevel;
}

function onPointerDown(ev) {
  if (!active || !doorMeshes.length) return;
  const r = canvasEl.getBoundingClientRect();
  pointerNDC.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointerNDC.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(doorMeshes, false);
  if (!hits.length) return;
  const hinge = hits[0].object.userData.hinge;
  if (hinge.userData.target !== 0) return;   // already opening
  if (reducedMotion()) { fireDoor(hinge); return; }
  hinge.userData.target = OPEN_ANGLE;
}

function fireDoor(hinge) {
  if (hinge.userData.fired) return;
  hinge.userData.fired = true;
  const fn = window[hinge.userData.action];
  if (typeof fn === "function") fn();
}

function render() {
  if (!active || !initialized) return;
  const now = performance.now();
  const dt = lastT == null ? 16.7 : Math.min(now - lastT, 100);
  lastT = now;
  const s = 1 - Math.pow(0.86, dt / 16.7);   // ~0.8s settle
  const eps = 0.004;
  const ez = (v, t) => (Math.abs(t - v) < eps ? t : v + (t - v) * s);

  // camera dolly / settle
  camPos.set(ez(camPos.x, camTargetPos.x), ez(camPos.y, camTargetPos.y), ez(camPos.z, camTargetPos.z));
  camLook.set(ez(camLook.x, camTargetLook.x), ez(camLook.y, camTargetLook.y), ez(camLook.z, camTargetLook.z));
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  // lights bloom
  if (Math.abs(lightTarget - lightLevel) > 0.002) { lightLevel += (lightTarget - lightLevel) * s; applyLights(); }

  // door swings
  const ds = 1 - Math.pow(0.80, dt / 16.7);
  for (const d of doorMeshes) {
    const h = d.userData;
    const hg = d.userData.hinge;
    if (hg.userData.angle !== hg.userData.target) {
      hg.userData.angle += (hg.userData.target - hg.userData.angle) * ds;
      if (Math.abs(hg.userData.target - hg.userData.angle) < 0.03) hg.userData.angle = hg.userData.target;
      hg.rotation.y = hg.userData.angle;
      // fire the action once the door is ~70% open
      if (hg.userData.target !== 0 && hg.userData.angle / hg.userData.target > 0.7) fireDoor(hg);
    }
  }

  renderer.render(scene, camera);
}

function resize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

window.LockerRoom = { init, enter, leave, render, resize };
