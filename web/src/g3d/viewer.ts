// Google Photorealistic 3D Tiles viewer — three.js + NASA-AMMOS 3d-tiles-renderer.
//
// Streams Google's real-world photoreal mesh (terrain + buildings + trees) for
// an arbitrary lat/lon, re-centered to the scene origin (Y-up) so gameplay math
// stays near 0,0,0 (ECEF is millions of meters out — precision would die).
//
// API surface verified against 3d-tiles-renderer@0.5.0. Attribution (Google
// logo + data credits) is MANDATORY per the Map Tiles API ToS and is rendered
// every frame from tiles.getAttributions().

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  DirectionalLight,
  AmbientLight,
  Sphere,
  MathUtils,
} from "three";
import { TilesRenderer, GlobeControls } from "3d-tiles-renderer";
import {
  GoogleCloudAuthPlugin,
  ReorientationPlugin,
  TilesFadePlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
  UnloadTilesPlugin,
} from "3d-tiles-renderer/plugins";
import type { CourseConfig } from "./config.js";

/** Tunable performance defaults — kept modest so we don't melt the GPU. */
export interface PerfOptions {
  /** Target screen-space error (px). Higher = coarser = faster. */
  errorTarget: number;
  /** Cache ceiling (tile count) before eviction. */
  cacheMaxSize: number;
  /** Cache floor kept resident. */
  cacheMinSize: number;
  /** Only re-render when the camera moves (UpdateOnChangePlugin). */
  pauseWhenIdle: boolean;
}

export const DEFAULT_PERF: PerfOptions = {
  errorTarget: 8,
  cacheMaxSize: 800,
  cacheMinSize: 600,
  pauseWhenIdle: true,
};

export interface ViewerHandle {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  tiles: TilesRenderer;
  controls: GlobeControls;
  reorient: ReorientationPlugin;
  /** Re-point the whole scene at a new course (one call, resets camera). */
  loadCourse: (config: CourseConfig) => void;
  dispose: () => void;
}

/**
 * Build the viewer, mount its canvas into `mount`, and start the render loop.
 * `onStatus` surfaces non-fatal messages (coverage gaps, load errors) for the UI.
 */
export function createViewer(
  mount: HTMLElement,
  apiToken: string,
  config: CourseConfig,
  attributionEl: HTMLElement,
  onStatus: (msg: string) => void = () => {},
  perf: PerfOptions = DEFAULT_PERF,
): ViewerHandle {
  // --- three.js core ---------------------------------------------------------
  const scene = new Scene();

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x0b0d10);
  mount.appendChild(renderer.domElement);

  // Near/far tuned for a site framed at hundreds of meters; GlobeControls also
  // adjusts these each frame, but sensible seeds avoid an ugly first paint.
  const camera = new PerspectiveCamera(60, 1, 1, 40000);

  // Photoreal tiles carry baked lighting, so lights are gentle — just enough to
  // keep any later placed (non-baked) game objects from reading pure black.
  scene.add(new AmbientLight(0xffffff, 1.0));
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(1, 2, 1);
  scene.add(sun);

  // --- tiles + plugins -------------------------------------------------------
  const tiles = new TilesRenderer();

  // Auth: plugin points at https://tile.googleapis.com/v1/3dtiles/root.json,
  // manages the session token, and injects the required Google logo.
  tiles.registerPlugin(
    new GoogleCloudAuthPlugin({ apiToken, autoRefreshToken: true }),
  );

  // Re-center chosen lat/lon to the scene origin, Y-up. recenter:true moves the
  // ellipsoid so our site sits at (0,0,0); we can re-target later via the plugin.
  const reorient = new ReorientationPlugin({
    up: "+y",
    recenter: true,
    lat: config.lat * MathUtils.DEG2RAD,
    lon: config.lon * MathUtils.DEG2RAD,
    height: config.height ?? 0,
  });
  tiles.registerPlugin(reorient);

  // Perf/quality plugins.
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new UnloadTilesPlugin());
  tiles.registerPlugin(new TilesFadePlugin());
  if (perf.pauseWhenIdle) tiles.registerPlugin(new UpdateOnChangePlugin());

  tiles.errorTarget = perf.errorTarget;
  tiles.lruCache.maxSize = perf.cacheMaxSize;
  tiles.lruCache.minSize = perf.cacheMinSize;

  tiles.setCamera(camera);
  scene.add(tiles.group);

  // --- controls --------------------------------------------------------------
  const controls = new GlobeControls(scene, camera, renderer.domElement);
  controls.setEllipsoid(tiles.ellipsoid, tiles.group);

  // --- attribution (mandatory) ----------------------------------------------
  // getAttributions() returns typed entries: 'image' = the Google logo (data
  // URI), 'string' = the data-credit text. Both must stay on screen per ToS.
  let lastAttribHtml = "";
  function renderAttribution() {
    const html = tiles
      .getAttributions()
      .map((a) =>
        a.type === "image"
          ? `<img src="${a.value}" alt="Google" style="height:18px;vertical-align:middle" />`
          : `<span>${a.value}</span>`,
      )
      .filter(Boolean)
      .join(" · ");
    if (html !== lastAttribHtml) {
      attributionEl.innerHTML = html;
      lastAttribHtml = html;
    }
  }

  // --- error + coverage handling ---------------------------------------------
  let sawError = false;
  tiles.addEventListener("load-error", (e: any) => {
    sawError = true;
    onStatus(`Tile load error: ${e?.error?.message ?? e?.url ?? "unknown"}`);
  });

  // After the first batch settles, check we actually got geometry. Rural sites
  // may return little/no photoreal mesh — that's expected, not a crash.
  const _sphere = new Sphere();
  tiles.addEventListener("tiles-load-end", () => {
    const ok = tiles.getBoundingSphere(_sphere);
    if (!ok || _sphere.radius === 0) {
      onStatus(
        `Low/no 3D coverage at ${config.name}. Rural areas render terrain-only or blank — try the urban fallback to verify the pipeline.`,
      );
    } else if (!sawError) {
      onStatus("");
    }
  });

  // --- camera framing --------------------------------------------------------
  // After reorientation our site is at the origin with +y up. Place the camera
  // for a close, oblique "backdrop" framing along the requested heading — NOT
  // pulled way back (that frames the distant low-LOD globe horizon instead of
  // the refined near ground). `far` is kept tight for the same reason.
  // GlobeControls takes over on first user input.
  function frameSite(cfg: CourseConfig) {
    const r = cfg.radiusMeters;
    const h = MathUtils.degToRad(cfg.headingDeg);
    // Ground plane is x/z after +y-up reorientation. ~24° look-down.
    camera.position.set(Math.sin(h) * r * 0.6, r * 0.45, Math.cos(h) * r * 0.6);
    camera.lookAt(0, r * 0.05, 0);
    camera.near = Math.max(1, r / 600);
    camera.far = r * 20;
    camera.updateProjectionMatrix();
  }
  frameSite(config);

  // --- switch course ---------------------------------------------------------
  function loadCourse(next: CourseConfig) {
    reorient.transformLatLonHeightToOrigin(
      next.lat * MathUtils.DEG2RAD,
      next.lon * MathUtils.DEG2RAD,
      next.height ?? 0,
    );
    frameSite(next);
    onStatus(`Loading ${next.name}…`);
  }

  // --- resize ----------------------------------------------------------------
  function onResize() {
    const w = mount.clientWidth || window.innerWidth;
    const hgt = mount.clientHeight || window.innerHeight;
    renderer.setSize(w, hgt);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", onResize);
  onResize();

  // --- render loop (per-frame calls are REQUIRED for LOD load/unload) --------
  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    controls.update();
    camera.updateMatrixWorld();
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.update();
    renderer.render(scene, camera);
    renderAttribution();
  }
  loop();

  function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    controls.dispose();
    tiles.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    scene,
    camera,
    renderer,
    tiles,
    controls,
    reorient,
    loadCourse,
    dispose,
  };
}
