"use strict";

// =====================================================================
//  Tunables — tweak these to change game feel
// =====================================================================
const TUNE = {
  fullPowerSwipe: 1120,  // trackpad wheel swipe speed (world u/s) = max power
  touchPowerSwipe: 400,  // touch/mouse flick speed (world u/s) = max power (calibrated to phone)
  wheelSensitivity: 1.0, // two-finger trackpad swipe -> swing power scaling
  wheelInvert: false,    // true if you use classic (non-natural) scrolling
  stopThreshold: 0.005,  // speed below this = ball stopped
  captureSpeed: 0.05,    // ball must be slower than this to drop in cup (low = hard)
  lipOutMaxSpeed: 0.18,  // putt at/under this that misses the cup is grabbed by the lip and dies 1–2 ft past; faster rams roll on
  chipRangeYds: 60,      // greenside chip mode auto-engages within this distance to the pin
  // Chip distance band: softest swipe flies chipReachLo×pin, hardest chipReachHi×pin (both
  // capped at club carry). Tight band -> a chip is never very short or very far from the hole.
  chipReachLo: 0.8,      // softest chip still flies 80% of the way to the pin
  chipReachHi: 1.2,      // hardest chip flies 120% (never blows way past)
  chipLandFrac: 0.75,    // chip CARRIES this much of the band target; the rest is roll-out
  chipSpin: 0.1,         // chip backspin multiplier (< full -> ball releases and rolls out)
  // Chip spin slider (bias -1..+1, 0 = neutral = the two values above). More spin ->
  // land deeper + check; less spin -> land short + run. Total still finishes near the pin.
  chipLandSpread: 0.22,  // bias shifts landFrac: 0.53 (full run) .. 0.75 (neutral) .. 0.97 (land at pin)
  chipSpinRange: 9,      // exponential backspin scale: chipSpin*9^bias -> 0.011 (run) .. 0.1 .. 0.9 (bites/backs up)
  puttSensitivity: 0.65,   // putt power scalar (< 1 = slower putts)
  // Putt control band: most putts are short, but max power reaches YARDS.maxPutt (50yd).
  // Two-segment power curve — the first puttControlFrac of input covers 0..puttControlYds
  // (the common 5–40ft band, low sensitivity = easy to lag), the top covers the rest up to max.
  puttControlYds: 12,      // distance (yards) the wide low-sensitivity segment tops out at (~36 ft)
  puttControlFrac: 0.72,   // fraction of input devoted to that wide control band
  // Pace forgiveness: on-green putt distance is clamped to this band around the cup
  // distance (plays-like). f=0 -> Lo, f=0.5 -> ~1.0, f=1 -> Hi. Putting = aim, not pace.
  puttBandLo: 0.8,   // softest swipe still rolls 80% of the way (never more than 20% short)
  puttBandHi: 1.2,   // hardest swipe rolls 120% (never more than 20% long)
  puttFloorFt: 6,    // inside this distance a putt is never left short — floor pace to reach the cup
                     // on flat (a soft downhill putt otherwise dies: its launch speed drops below
                     // slopeStopSpeed before the downhill slope-aid it was discounted for kicks in)
  // Forgiveness: every full-swing club (incl. LW) flies ≥ clubMinFrac of its rated carry, so a
  // misread weak stroke can't dribble. Putter + greenside chips keep their own range/band.
  clubMinFrac: 0.70,
  // Pace forgiveness at the cup: a grounded putt that crosses near-dead-center at a good
  // (not rammed) pace is grabbed by the lip and drops, like real life. Off-center / faster
  // passes keep the normal lip-out. Only rewards already-good pace + line.
  captureAssist: 0.08,     // max speed for the edge-catch drop (≈1.6× captureSpeed)

  // --- Ball flight ---
  launchAngleDeg: 40,    // launch angle of a full shot (putts stay grounded)
  gravity: 0.044,        // downward accel (world units / frame^2) while airborne
  airDrag: 0.998,        // per-frame horizontal velocity bleed in the air
  spinFactor: 0.01,     // how hard a curved swipe bends flight (draw/fade)
  windEffect: 0.0002,   // world-units/frame² per mph — how hard wind pushes the ball
  playsLikePerFoot: 1.0, // caddie "plays like": yards added per foot of climb to the pin (uphill plays longer)

  // Lie penalty: launch power multiplier by the surface you're hitting FROM.
  // Rough/sand grab the club and cost distance; clean lies (fairway/tee/green) full.
  lie: { fairway: 1.0, tee: 1.0, green: 1.0, rough: 0.72, bunker: 0.5, water: 0.5, woods: 0.5, ob: 0.5 },
  // Lie spin penalty: backspin multiplier by the surface you're hitting FROM. Rough = "flyer"
  // (grass between club & ball kills backspin -> ball releases and runs out); sand also robs spin.
  lieSpin: { fairway: 1.0, tee: 1.0, green: 1.0, rough: 0.55, bunker: 0.6, water: 0.6, woods: 0.6, ob: 0.6 },
  // Lie land-angle penalty: a flyer from rough comes in SHALLOWER as well as lower-spin
  // (less lift), so it releases even more on landing. Multiplier on the club's land angle.
  lieLand: { fairway: 1.0, tee: 1.0, green: 1.0, rough: 0.88, bunker: 0.92, water: 1.0, woods: 1.0, ob: 1.0 },

  friction: {            // per-frame velocity multiplier by surface (rolling)
    fairway: 0.97,
    rough:   0.90,
    bunker:  0.55,       // sand grabs hard — the ball stops fast
    water:   0.80,       // ball decelerates fast in water before penalty
    woods:   0.45,       // trees/brush kill the ball fast (then OB penalty)
    ob:      0.45,       // out of bounds (off the aerial mask) — same dead stop, penalty on rest
  },
  // The green rolls realistically: CONSTANT deceleration per frame (not a
  // velocity multiplier), so the ball holds speed and glides, then dies — the
  // way a real green / stimpmeter behaves. Derived from greenSpeed below.
  greenDecel: 0,
  // Slope-aware putting: a rolling ball is pushed downhill along the synthetic
  // green field's gradient. slopeAccel folds the field's vertical scale + gravity
  // into one knob (world-units/frame^2 per unit gradient); calibrate by feel.
  // Slope is ignored below slopeStopSpeed so a ball settles instead of creeping.
  slopeAccel: 0.0036,         // break strength; capped at slopeCapFrac of greenDecel so ball can always stop
  slopeCapFrac: 0.82,         // slope force ceiling as a fraction of greenDecel (higher = more break on steep greens, but less guaranteed decel)
  fairwaySlopeAccel: 0.0003,  // terrain slope accel on fairway/rough (gentler than green break)
  slopeStopSpeed: 0.028,
  // Anti-pixelation detail grain: past the aerial's native resolution a
  // world-anchored procedural grass grain fades in (soft-light) so deep zoom
  // reads as fine turf texture instead of bilinear mush. Ramp is measured in
  // screen px per SOURCE aerial px (k): invisible at k<=lo, full at k>=hi.
  detailAlpha: 0.55,     // peak grain opacity at deep zoom
  detailRampLo: 1.5,     // grain starts fading in past this magnification
  detailRampHi: 5,       // ...and saturates here
  detailTileUnits: 4,    // world units (~12 yds) covered by one grain tile
  // Shaded-relief topo overlay (greens only). Intensity = drawImage globalAlpha.
  reliefAmbient: 0.14,   // always-on whisper on the in-play / target green
  reliefFull: 0.32,      // boosted by the slope button (+ fall-line arrows)
  reliefExag: 6,         // vertical exaggeration -> hillshade contrast
  reliefShade: 1.8,      // highlight/shadow alpha scale per unit of relief
  reliefTint: 0.35,      // max warm-tint alpha on the steepest spots (a hint, not a ramp)
  // Flow dots: particles drifting downhill on greens-in-play (slope mode).
  // Speed AND brightness scale with local gradient, so flat spots show a slow
  // faint drift while steep runs read as fast bright streams.
  flowDensity: 2.0,      // dots per world-unit^2 of green area
  flowMaxDots: 240,      // hard cap per green (perf)
  flowSpeed: 0.018,      // world units/frame at max gradient
  flowMinFrac: 0.15,     // floor speed fraction on near-flat spots
  flowTTLMin: 90, flowTTLMax: 210,  // dot lifetime (frames)
  flowAlpha: 0.78,       // peak dot opacity
  flowTrail: 6,          // streak length in frames of motion
  // Slightly-3D tilted course view (the HUD 3D toggle): the whole scene is
  // y-squashed in screen space (affine axonometric lean), so the aerial,
  // overlays, input inversion and culling all follow the one view transform.
  tiltCos: 0.55,         // ground-plane squash when ON (cos of the lean; 1 = flat top-down)
  // True-3D relief in the tilted view: the DEM displaces the ground vertically
  // on screen (column-band warp), trees stand up from the woods mask, and a
  // hillshade overlay sells the slopes. All of it fades in with camera.tilt.
  tExag: 1.6,            // terrain relief exaggeration (1 = true DEM scale)
  // Synthetic elevation fed into terrainZ so the tilted view actually rolls even
  // on DEM-less courses (nearly all of them). Greens get a real, exaggerated
  // undulation you can read break off; the whole course gets gentle cosmetic swells.
  gUndOn: true,          // master switch: green vertical relief in the tilted view
  gUndScale: 0.18,       // world-units per abstract green-h unit (~1.5ft realistic; 1 unit = 9ft)
  gUndExag: 2.5,         // readability exaggeration atop realistic (net on-green ~4ft)
  gUndFall: 6.0,         // world-unit smoothstep falloff outside a green bbox -> 0 (no fairway distortion)
  gBroadAmp: 0.25,       // broad COSMETIC terrain amplitude, world units (~2ft); 0 disables. Physics ignores it.
  gBroadWL: 130,         // broad value-noise wavelength, world units (long gentle swells)
  tWarpCol: 10,          // warp column width, css px (×1.3 on mobile) — narrow
                         // enough that lift steps between columns don't tear
                         // the high-contrast lifted canopy texture
  tWarpRow: 24,          // warp band height, css px (×1.3 on mobile)
  treeMax: 3500,         // cap on generated trees per course (sprite fallback)
  treeDarkLum: 92,       // aerial luma (0-255) below which an OB mask cell counts as forest
                         // canopy (with a blue guard for water) — Four Oaks-style courses
                         // ring the course in real forest the mask files under OB, not WOODS
  treeTexture: 18,       // luma step to a 4-neighbor at mask res above which a green mid-
                         // luma cell reads as textured canopy (dappled crowns) vs smooth turf
  treeFringePasses: 6,   // dark-ROUGH fringe growth iterations (≈1 mask cell ≈ 3yd each):
                         // lets the treeline the envelope filed under ROUGH join the
                         // forest, but only by creeping out from confirmed canopy
  treeEdgeR: 4,          // mask cells: woods cell within this of non-woods = forest edge
  treeEdgeBoost: 5,      // edge cells keep trees at this × base rate — the tree WALL along
                         // a fairway is what reads from ground level (Four Oaks 3D); deep
                         // forest interior reads as texture, so it thins instead (below)
  treeInteriorMul: 0.5,  // interior cells keep at this × base rate (pays for the edge boost)
  treeHMin: 3.5, treeHMax: 6.5, // tree height range, world units (~30–60 ft)
  canopyH: 4.6,          // photo-canopy extrusion height, world units (~40 ft)
  tHillAlpha: 0.22,      // DEM hillshade overlay strength when fully tilted
  tPlanarTol: 3.0,       // css px: max plane-fit residual to warp with ONE affine draw
  tPadMax: 320,          // capture pad ceiling (putt-zoom canopy lift can reach ~250px)
  tPadQuant: 32,         // pad quantum — stops per-frame capture reallocs while zooming
  canopyTiers: [0.75, 1.0, 1.25], // staggered clump heights ×canopyH (breaks the flat slab)
  canopyFeather: 0.7,    // mask-px alpha feather baked at canopy build
  tWallLayers: 2,        // smeared wall copies per tier parked; 1 while camera moves
  tMotionCoarse: 2,      // warp band size multiplier while the camera is moving
  // Angle-bucket warp cache: while aim-holding rotates the camera, pre-baked
  // ground rasters at discrete angles are cross-dissolved instead of a full
  // recapture every frame (see bakeBucket/warpSig split near _bucketCache).
  tAngleBuckets: 32,       // buckets around the full circle (~11.25° each)
  tBucketMax: 12,          // resident bucket canvases before LRU eviction (desktop; mobile halves this)
  tBucketPrebakeRadius: 2, // idle prebake warms this many buckets each side of the parked angle
  tBucketIdleGapMs: 400,   // camera must be parked+idle this long before idle prebaking starts
  punchBallR: 4.5,       // world units: canopy punch-out radius around the ball
  punchCupR: 3.5,        // world units: around the cup
  punchGreenFeather: 2.0,// world units: soft falloff outside green-in-play polys
  flowFadeLo: 8, flowFadeHi: 14, // view.scale ramp: flow dots fade out zoomed-out (tilted)
  // 3D green inspect view (the "read green" button)
  gvGrid: 36,            // mesh cells per axis
  gvTilt: 0.95,          // initial viewing tilt (rad from top-down; 0 = flat plan view)
  gvTiltMin: 0.12, gvTiltMax: 1.48,   // near plan-view ↔ near ground-level (past ~1.5 the slab flips)
  gvHeight: 0.07,        // full height range as a fraction of green radius (~true scale: field spans ±3ft)
  gvYawRate: 0.010,      // rad per horizontal drag px
  gvTiltRate: 0.006,     // rad per vertical drag px
  // Cinematic 3D landing: a launch-time forward sim (simShotRest) predicts where an
  // off-green shot finishes; if it's a great one — holed, lipped out, or resting on a
  // green inside the distance-scaled threshold below — the game cuts to the 3D green
  // as the ball descends. The bar scales with shot length so a 200yd approach earns
  // the cut at ~10 ft while a greenside chip needs a near kick-in.
  cineFtPerYd: 0.05,     // trigger distance (ft from the cup) per yard of shot length
  cineMinFt: 4,          // floor of that trigger distance (short chips)
  cineMaxFt: 11,         // ceiling (long approaches)
  cineCutFrac: 0.35,     // cut to 3D this far down the descent (0 = apex, 1 = touchdown)
  cineHoldMs: 900,       // linger on the settled ball before returning to the course
  cineZoomIn: 1.18,      // slow push-in over the landing (multiplies the fit-to-screen zoom)
  cineZoomMs: 2600,      // duration of the push-in ease
  cineYawDrift: 0.04,    // gentle orbit (rad/s) while the cinematic plays
  cineBallZ: 1.0,        // flight-height scale in the 3D view (1 = true world scale)
  cineSimSteps: 4000,    // forward-sim frame cap (~66s of ball time — never binds in practice)
  // Landing behaviour per surface: e = vertical restitution (bounce height),
  // h = horizontal speed retained on impact (grab/check). Real per-course
  // values will come from the course API later.
  bounce: {
    green:   { e: 0.30, h: 0.35 },  // greens hold the ball
    fairway: { e: 0.40, h: 0.48 },  // firm, releases forward
    rough:   { e: 0.22, h: 0.28 },  // deadens the ball
    bunker:  { e: 0.05, h: 0.12 },  // plugs in the sand, almost no release
    water:   { e: 0.0,  h: 0.0  },  // splash (penalty handled on roll-stop)
    woods:   { e: 0.0,  h: 0.1  },  // trees stop it dead (OB penalty on stop)
    ob:      { e: 0.0,  h: 0.1  },  // out of bounds — dead stop
  },
  bounceStopVz: 0.06,    // downward speed below which the ball stops bouncing
  // Out of bounds (woods + aerial-mask OOB): +1 penalty, replay from last safe
  // spot. Toggle off for a forgiving round (ball stays playable where it lands).
  obPenalty: true,

  // Full 14-club bag, each shot's trajectory mirrored to PGA Tour (Trackman)
  // averages: carry + max HEIGHT + LAND angle + ball speed. The flight follows a
  // per-club arc that hits all three (real balls launch low but land steep from
  // spin/lift — a plain projectile can't). PW and below from the table; SW/LW
  // extrapolated. Putter is the on-green roll (handled separately).
  clubs: {                                    // carry, maxH, land°, ballMph, spinRpm
    driver: { name: "Driver", carry: 282, maxH: 35, land: 39, ball: 171, spin: 2545 },
    "3w":   { name: "3 Wood", carry: 249, maxH: 32, land: 44, ball: 169, spin: 3663 },
    "5w":   { name: "5 Wood", carry: 236, maxH: 33, land: 48, ball: 156, spin: 4322 },
    hybrid: { name: "Hybrid", carry: 231, maxH: 31, land: 49, ball: 149, spin: 4587 },
    "3i":   { name: "3 Iron", carry: 218, maxH: 30, land: 48, ball: 145, spin: 4404 },
    "4i":   { name: "4 Iron", carry: 209, maxH: 31, land: 49, ball: 140, spin: 4782 },
    "5i":   { name: "5 Iron", carry: 199, maxH: 33, land: 50, ball: 135, spin: 5280 },
    "6i":   { name: "6 Iron", carry: 188, maxH: 32, land: 50, ball: 130, spin: 6204 },
    "7i":   { name: "7 Iron", carry: 176, maxH: 34, land: 51, ball: 123, spin: 7124 },
    "8i":   { name: "8 Iron", carry: 164, maxH: 33, land: 51, ball: 118, spin: 8078 },
    "9i":   { name: "9 Iron", carry: 152, maxH: 32, land: 52, ball: 112, spin: 8793 },
    pw:     { name: "PW",     carry: 142, maxH: 32, land: 52, ball: 104, spin: 9316 },
    sw:     { name: "SW",     carry: 115, maxH: 31, land: 53, ball: 95,  spin: 10500 },
    lw:     { name: "LW",     carry: 90,  maxH: 30, land: 55, ball: 82,  spin: 11500 },
    putter: { name: "Putter", carry: 30,  maxH: 0,  land: 0,  ball: 0,   spin: 0    },
  },

  // Backspin grip on landing, by surface (greens grab hardest -> can spin back;
  // rough is a flyer with little spin). 0..1 multiplier on the club's spin.
  spinGrip: { green: 1.0, fairway: 0.5, tee: 0.5, rough: 0.12, bunker: 0.3, woods: 0, water: 0, ob: 0 },
  rolloutK: 7.0,    // CHIP release distance scale (× landing speed) — low skidding balls release more
  rolloutKFull: 4.0,// FULL-shot release scale: calibrated so totals match tour (driver ~305,
                    // hybrid ~246, 7i ~184); 7 made everything run ~2× real fairway rollout
  spinCheckK: 1.35, // how strongly the landing check kills/reverses the release (>1 can back up)
  // Landing check = weighted blend of backspin AND descent steepness. A tour 5-iron
  // holds because it lands at ~50°, not because it spins like a wedge (TrackMan: every
  // iron lands 46–52°; ≥45° descent holds with modest spin, mid-30s won't even with spin).
  checkSpinW: 0.55,   // backspin's share of the landing check
  checkLandW: 0.45,   // descent-angle steepness's share
  checkLandRef: 35,   // land angle (deg) where steepness starts to grip (driver ~39° ≈ none)
  checkLandSpan: 20,  // degrees above ref for full steepness credit
  spinBackMax: 1.2,   // cap on backward roll after a spun-back landing (world units ≈ 3.6yd)
  applePitchDeg: 55,  // Apple-ground 3D view: MKMapCamera pitch when the tilt toggle is on
  // Flight selector (right gutter, full shots off the green): -1 Low .. 0 Stock .. +1
  // High. High throws the ball higher with extra spin — steeper landing + harder check
  // holds firm/tucked greens — at the cost of a little carry and more wind drift. Each
  // flightHi* knob is the +1 endpoint; effect lerps continuously from stock at 0.
  flightHiApex: 1.25,   // apex height multiplier
  flightHiLand: 3,      // degrees added to the club's land angle
  flightHiSpin: 1.25,   // backspin (spinN) multiplier, capped at 1
  flightHiCarry: 0.95,  // carry multiplier (throwing it up costs distance)
  flightHiWind: 1.3,    // wind-effect multiplier while the high ball is in the air
  // Low = the -1 endpoint: a knockdown/punch — flatter flight, shallower landing so it
  // releases/runs instead of checking, a touch less backspin, punches through wind, at a
  // small carry cost (the shallower landDeg already adds rollout via landingRelease()'s
  // check/steepness term, so total distance isn't as far down as the carry hit alone).
  flightLoApex: 0.75,   // apex height multiplier
  flightLoLand: -8,     // degrees subtracted from the club's land angle
  flightLoSpin: 0.8,    // backspin (spinN) multiplier
  flightLoCarry: 0.9,   // carry multiplier
  flightLoWind: 0.5,    // wind-effect multiplier while the low ball is in the air

  // powerFactor, maxPower, puttMaxPower, puttOffGreenPower, launchAngle are derived below.
  powerFactor: 0,
  maxPower: 0,
  puttMaxPower: 0,
  puttOffGreenPower: 0,  // putter from off-green (fairway bump-and-run), calibrated to fairway friction
  launchAngle: 0,
};

// Faster greens roll more (less deceleration) and are harder. Stimp -> green
// deceleration: decel = GREEN_DECEL_K / stimp (higher stimp = ball glides
// farther before stopping). Per-course later.
const GREEN_DECEL_K = 0.008;   // lower = greens roll out farther (more glide / less friction)

// Real-world yardages. A full swing CARRIES YARDS.maxCarry in the air (bounce +
// rollout add more); a full putt on the green rolls at most YARDS.maxPutt.
const YARDS = { maxCarry: 270, maxPutt: 50 };

// World bounds are per-hole (set when a hole loads); start with a sane default.
const WORLD = { w: 100, h: 180 };

// Fixed world scale: yards per world unit, CONSTANT across holes so a given
// swing means the same distance everywhere. Overridden by course.yardsPerUnit.
let YARDS_PER_UNIT = 3.0;
// Cup capture radius (world units) and default green speed — OSM carries no
// stimp rating, so we default it; per-course green speeds come later.
// Hole: real is 4.25" (~0.02 units) but that's brutal for feel-based putting, so
// the cup plays a bit larger / more forgiving on the green.
const HOLE_RADIUS_UNITS = 0.055;
// Real golf ball: 1.68" diameter -> ~0.023 yd radius -> ~0.008 units.
const BALL_RADIUS_UNITS = 0.008;
const DEFAULT_STIMP = 11;

// =====================================================================
//  Hole data
// =====================================================================
// The live hole (geometry in world units). Built by setHole() from loaded
// course data; surfaces are arrays of polygons keyed by surface type. A
// hardcoded fallback (FALLBACK_HOLE) is used if the course fetch fails.
//   { par, yards, teePos, holePos, holeRadius, greenSpeed, world:{w,h},
//     surfaces: { green:[poly], fairway:[poly], bunker:[poly], water:[poly],
//                 tee:[poly] } }   where poly = [{x,y}, ...]
let HOLE = null;

// =====================================================================
//  Derived power — FIXED across holes (so swing feel is consistent). Recomputed
//  only if the world scale or green speed changes.
// =====================================================================
let MAX_CARRY_UNITS = 0;
function recalcPower() {
  // Full shots follow a per-club arc (see setupFlight); only the putt caps are
  // derived here. Putts: roll distance D = v0^2 / (2*decel) -> v = sqrt(2*decel*D).
  TUNE.puttMaxPower = Math.sqrt(2 * TUNE.greenDecel * (YARDS.maxPutt / YARDS_PER_UNIT));
  // Off-green putter (bump-and-run): fairway friction=0.97 → roll dist ≈ v/(1-friction).
  // Calibrate so a max swing rolls ~30 yards on fairway.
  TUNE.puttOffGreenPower = (30 / YARDS_PER_UNIT) * (1 - TUNE.friction.fairway);
  // Normalize each club's spin (rpm) to 0..1 for the landing check/backspin.
  for (const c in TUNE.clubs) {
    TUNE.clubs[c].spinN = Math.max(0, Math.min(1, (TUNE.clubs[c].spin - 2500) / 7500));
  }
}
TUNE.greenDecel = GREEN_DECEL_K / DEFAULT_STIMP;
recalcPower();

// Bag order, longest carry -> shortest (for the +/- club selector). Putter last.
const CLUB_ORDER = ["driver", "3w", "5w", "hybrid", "3i", "4i", "5i", "6i",
                    "7i", "8i", "9i", "pw", "sw", "lw", "putter"];
// Club whose full carry is closest to a distance (yards). Never selects putter (manual only).
function clubForYards(y) {
  let best = CLUB_ORDER[0], bd = Infinity;
  for (const k of CLUB_ORDER) {
    if (k === "putter") continue;
    const d = Math.abs(TUNE.clubs[k].carry - y);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
let autoClubEnabled = true;
let manualClubThisShot = false; // one-shot manual override; auto resumes next shot
let windEnabled = false;
// Auto-select the club for the current shot (course only; putter is auto on green).
function autoClub() {
  if (!autoClubEnabled || manualClubThisShot || mode === "range" || !HOLE) return;
  // Pick the club for the elevation-adjusted ("plays like") distance, like a caddie.
  selectedClub = clubForYards(playsLikeYards(state.ball.x, state.ball.y).plays);
}

// =====================================================================
//  Analytics
// =====================================================================
// Thin, no-op-safe wrapper over PostHog (initialised cookieless in index.html).
// Never throws, so a missing key or a blocked CDN can't affect gameplay. Only
// product-usage events for retention/funnels — no PII beyond an anonymous id.
function track(event, props) {
  try { if (window.posthog && posthog.capture) posthog.capture(event, props || {}); }
  catch (e) { /* analytics must never break the game */ }
}

// =====================================================================
//  Ads — rewarded, opt-in ONLY (see ADS.md)
// =====================================================================
// Hard rule: an ad NEVER plays without an explicit player tap. No interstitials,
// no banners over gameplay. showRewarded() is the single entry point; it's
// provider-agnostic so the SDK can be swapped without touching game logic.
const ADS = {
  enabled: true,        // master switch (a future no-ads purchase also disables)
  provider: "stub",     // "stub" (demo) | "crazygames" | "gam" — swap when a real SDK is wired
};

// May we offer an ad right now? (Respects the no-ads flag + age.) Callers gate
// the *offer* on this; the ad itself still needs a tap.
function adsAvailable() {
  if (!ADS.enabled) return false;
  if (lsGet("golf.noAds", false)) return false;         // future "remove ads" entitlement
  if (lsGet("golf.under13", false)) return false;        // never serve ads to minors
  // Esri World Imagery terms forbid monetized use — only NAIP (public-domain) or
  // vector-only (no baked aerial) courses are ad-legal. Non-US/Originals courses
  // still on Esri (st-andrews-old, arabian-ranches, faldo-course, blackwater-vale,
  // crystal-lake-haverhill) stay ad-free until re-sourced.
  if (course && course.aerial && course.aerial.src !== "naip") return false;
  return true;
}

// Play a rewarded ad. Resolves true only if the player watched to the reward,
// false if they closed early or none was available. PLAYER-INITIATED ONLY.
function showRewarded(reason) {
  track("ad_offer_taken", { reason, provider: ADS.provider });
  try {
    // Real providers (wire when ready) — both expose a promise/callback that
    // resolves on reward. Keep the shapes here so swapping is a one-liner.
    if (ADS.provider === "crazygames" &&
        window.CrazyGames && CrazyGames.SDK && CrazyGames.SDK.ad) {
      return CrazyGames.SDK.ad.requestAd("rewarded")
        .then(() => true).catch(() => false);
    }
    // TODO(gam): Google H5 Games Ads rewarded via googletag.rewardedSlot().
  } catch (e) { /* fall through to the demo */ }
  return showStubAd(reason);   // dev/demo: a labelled placeholder, resolves true after a beat
}

// =====================================================================
//  Sharing — native share sheet with clipboard fallback (viral loop)
// =====================================================================
// The public game URL every share points at (NOT location.origin — a share from
// a localhost/dev build should still send people to the real game).
const SHARE_URL = "https://yo-golf.com/";

// Share a result via the OS share sheet (navigator.share, mobile) → clipboard
// fallback (desktop). Must be called from a user gesture (a button click).
async function shareResult(text) {
  track("share_taken", { where: "round" });
  try {
    if (navigator.share) { await navigator.share({ text, url: SHARE_URL }); return; }
  } catch (e) {
    if (e && e.name === "AbortError") return;   // user dismissed the sheet — not an error
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text + " " + SHARE_URL);
      showToast("Copied — paste to share", 2000);
      return;
    }
  } catch (e) { /* fall through */ }
  showToast("Sharing isn't available here", 1800);
}

// One-line share caption for the round just finished (daily includes the streak).
function roundShareText() {
  const totStrk = round.holeStats.reduce((s, h) => s + h.strokes, 0);
  if (dailyMode) {
    const st = getDaily();
    const date = (dailyInfo && dailyInfo.date) || todayStr();
    return `Golf Daily ${date} · ${totStrk} (${formatToPar(round.score)}) · ⛳️🔥${st.streak || 1}`;
  }
  const cn = course ? course.name : "Golf";
  return `⛳️ I shot ${totStrk} (${formatToPar(round.score)}) at ${cn} on Golf`;
}

// Demo "ad": a clearly-labelled placeholder so the rewarded flow is testable
// before a real SDK exists. Never ships as a real ad — swap ADS.provider.
function showStubAd(reason) {
  return new Promise((resolve) => {
    const ov = document.getElementById("ad-stub");
    const claim = document.getElementById("ad-stub-claim");
    const cancel = document.getElementById("ad-stub-cancel");
    const count = document.getElementById("ad-stub-count");
    if (!ov || !claim || !cancel) { resolve(true); return; }
    let n = 3, timer = null;
    const cleanup = (result) => {
      if (timer) clearInterval(timer);
      claim.onclick = cancel.onclick = null;
      ov.classList.add("hidden");
      resolve(result);
    };
    claim.disabled = true;
    count.textContent = `Reward in ${n}…`;
    ov.classList.remove("hidden");
    timer = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(timer); timer = null; claim.disabled = false; count.textContent = "Ready"; }
      else count.textContent = `Reward in ${n}…`;
    }, 1000);
    claim.onclick = () => cleanup(true);
    cancel.onclick = () => cleanup(false);
  });
}

// =====================================================================
//  State
// =====================================================================
let state;
function resetState() {
  holeDrop = null;   // clear any in-flight drop animation on a fresh hole
  state = {
    // z = height above ground, vz = vertical velocity, spin = sidespin (curve)
    ball: { x: HOLE.teePos.x, y: HOLE.teePos.y, vx: 0, vy: 0, z: 0, vz: 0, spin: 0 },
    flight: null,                                     // active per-club arc, or null
    lastSafe: { x: HOLE.teePos.x, y: HOLE.teePos.y }, // restore point for water
    moving: false,
    airborne: false,
    strokes: 0,
    inHole: false,
    // per-hole stats
    putts: 0,            // strokes taken while on the green
    strokesOffGreen: 0,  // strokes taken from off-green (for GIR calculation)
    greenReached: false, // has ball been on the green this hole?
    proximity: null,     // yards to pin when ball first reached green
    gir: false,          // green in regulation
    fairwayHit: null,    // null = par 3, true/false = par 4/5
    _teeShot: false,     // flag: next stop determines fairway hit
  };
}

// Game mode: "menu" (home) | "course" | "range". Input is off in the menu.
let mode = "menu";
// Four Oaks 3D (three.js) — true only on that course, in course mode, opted in.
// Gates the whole course-render half of draw() off; ball physics/HUD/scoring
// are untouched either way (see window.GolfBridge + update3DMode below).
let render3D = false;
function render3DWanted() {
  if (!course || course.id !== "four-oaks-dracut") return false;
  if (mode !== "course" || (typeof HOLE !== "undefined" && HOLE && HOLE.isRange)) return false;
  try {
    if (/[?&]3d=1\b/.test(location.search)) return true;
  } catch (e) { /* location unavailable, fall through to the stored toggle */ }
  return lsGet("golf.render3D", false); // set by the "Play in 3D" course-card badge (renderCourseCards)
}
function update3DMode() {
  const want = render3DWanted();
  if (want === render3D) return;
  render3D = want;
  // #game stays visible+in-layout either way (swing input is bound to it —
  // see the "Input" section); go transparent so #c3d (behind it, z-index -1
  // in base.css) shows through. draw() early-returns while render3D is true,
  // so nothing repaints over this until we leave 3D (then draw() resumes and
  // naturally overwrites it every frame — no explicit un-clear needed).
  if (render3D) ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (window.Course3D) {
    if (render3D) window.Course3D.enter(); else window.Course3D.leave();
  }
}
// Apple MapKit ground layer (Butter Brook) — NOT a render3D-style full-frame
// takeover. Apple is this course's ground renderer always, the same way the
// baked NAIP aerial is every other course's ground renderer always; there is
// no 2D/Apple toggle. draw() (below) skips only the ground-paint calls for
// this course and keeps drawing ball/flag/HUD/contours exactly as normal —
// a native MKMapView sits behind the transparent-there canvas, camera synced
// each frame to the game's own view/camera state via course.geo.toLonLat
// (tools/geo_anchor_course.py). See CourseMap3DPlugin.swift.
function appleGroundActive() {
  return !!(course && course.id === "butter-brook-golf-club" && course.geo &&
    mode === "course" && !(typeof HOLE !== "undefined" && HOLE && HOLE.isRange) &&
    window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() &&
    window.Capacitor.Plugins && window.Capacitor.Plugins.CourseMap3D);
}
let _appleGroundEntered = false;
let _lastAppleSync = 0;
// Stage 3 (current): center + zoom + heading + PITCH, one camera model on
// both sides of the bridge.
//
// Flat mapping (see computeViewMatrix): screen = s·R(θ)·(world − focus) +
// playCenter, world axes north-up (x=east, y=south, from geo.toLonLat's
// diagonal signs), so the compass heading of "screen up" is exactly −θ.
//
// MKMapCamera is a pinhole camera looking at centerCoordinate from a
// line-of-sight distance, vertical FOV ~30° (APPLE_CAM_K = 1/(2·tan 15°);
// distance = visible-vertical-span · K at pitch 0 — calibrated against
// screenshots). When the 3D toggle pitches that camera, an affine canvas
// can't line up with a perspective map anymore — so buildAppleProj()
// replicates the SAME pinhole in JS each frame, and wx()/wy()/screenToWorld()
// route every overlay vertex through it (view.appleProj). What Apple renders
// and what the canvas draws are then the same projection by construction;
// pitch 0 reduces to the affine exactly (px/m = cssH·K/(spanM·K·1) = scale/m).
const APPLE_CAM_K = 1.866; // 1/(2·tan(30°/2)) — MapKit vertical FOV constant
// Flyover's minimum camera distance (measured 155.4 m in the simulator; margin
// on top). The game must never request closer — past the clamp MapKit both
// clamps distance AND drifts the visual center unreported (see buildAppleProj).
const APPLE_MIN_DIST_M = 165;
// MapKit's pitch pivot sits this many metres ABOVE the flyover's terrain at
// the center coordinate. Re-measured 2026-07-12 (pitch-0 vs pitch-55 shots of
// the SAME camera, cross-correlated, look-at on OPEN ground at D=600–1300 m):
// ~0–3 m — the pivot sits essentially ON MapKit's terrain model. The earlier
// 23 m ("geoid separation") was a measurement artifact: that calibration's
// center feature was FOREST, and flyover renders canopy ~23 m above the
// terrain the pivot anchors to, so the feature's pitch-shift measured tree
// height, not pivot float. A wrong constant here is why the overlay slid
// across the map when the camera rotated: the residual screen offset
// unprojects to a world error that turns with the heading.
// window.__appleDrop overrides for live re-tuning via devdrive.
const APPLE_ANCHOR_DROP_M = 2;
let applePitch = 0;        // current MKMapCamera pitch, degrees (tweened)
let applePitchT = 0;       // target — driven by the tilt toggle on Apple-ground courses
// The camera MapKit ACTUALLY applied (syncCamera's resolve value) + what we
// had requested. MapKit silently clamps — flyover enforces a minimum camera
// distance and a zoom-dependent max pitch — and at putt zoom that pushed the
// real map half a screen off the overlay's assumed camera. Where actual and
// requested disagree beyond tolerance, buildAppleProj renders from the
// ACTUAL value, so the overlay always draws what the map really shows.
let _appleActualCam = null;
// Ground-truth screen positions of 3 probe coordinates under the REAL map
// camera + the request they answered. The Swift side anchors an invisible
// 1x1 MKAnnotationView at each probe lat/lon — MapKit positions those views
// through its real flyover render (terrain anchor state included), so their
// centers are exact "where does this coordinate render" answers. This is the
// only runtime oracle for the flyover pitch anchor, which MapKit re-samples
// NONDETERMINISTICALLY from whatever mesh LOD is loaded on every camera set
// (measured: identical MKMapCamera, renders 100-200 px apart across visits —
// no constant drop can model that; the old MKMapView.convert() probes
// projected through the flat mercator viewport and never saw it).
// buildAppleProj fits a screen-affine from its replica onto these answers,
// so the overlay tracks what the map ACTUALLY shows, anchor rolls and all.
let _appleCal = null;
// Smoothed calibration affine (eases toward each fresh fit; identity when
// none) — raw per-sync fits would pop the whole overlay on anchor re-rolls.
const _calS = { a: [1, 0, 0, 1], b: [0, 0] };
// Sticky probe coordinates (see syncAppleGround) + last 3 fit targets for
// the median filter in buildAppleProj.
let _probeLL = null, _probeLLW = null;
const _fitHist = [];
function buildAppleProj(cssW, cssH) {
  // Look-at target O = the world point at the true screen center under the
  // FLAT view (game camera logic — focus/fit/aim — stays orthographic and
  // untouched; the perspective is layered on top of it).
  const det = view.a * view.e - view.b * view.d || 1;
  const sx0 = cssW / 2 - view.c, sy0 = cssH / 2 - view.f;
  let Ox = (view.e * sx0 - view.b * sy0) / det;
  let Oy = (-view.d * sx0 + view.a * sy0) / det;
  const m = M_PER_UNIT;
  // Requested center in geo terms (also what syncAppleGround sends).
  const g = course.geo.toLonLat;
  const reqLat = g[3] * Ox + g[4] * Oy + g[5];
  const reqLon = g[0] * Ox + g[1] * Oy + g[2];
  // What the game WANTS (always what gets sent over the bridge — the map
  // re-clamps for itself every frame):
  const reqDistM = (cssH / camera.scale) * m * APPLE_CAM_K; // line-of-sight, metres
  const reqPitch = applePitch;
  // What the overlay RENDERS: fold in MapKit's clamps (see _appleActualCam).
  // Only adopt an actual value when it disagrees with what we asked for —
  // tracking actuals verbatim would add a frame of bridge lag to every
  // pan/aim for nothing. Guard on the request still being comparable to the
  // one the actual answered (camera may have moved since).
  let distM = reqDistM, pitchDeg = reqPitch;
  const ac = _appleActualCam;
  if (ac) {
    if (Math.abs(ac.reqDistM - reqDistM) < reqDistM * 0.2 && Math.abs(ac.distM - ac.reqDistM) > ac.reqDistM * 0.01) distM = ac.distM;
    if (Math.abs(ac.reqPitch - reqPitch) < 3 && Math.abs(ac.pitch - ac.reqPitch) > 0.5) pitchDeg = ac.pitch;
    // NOTE: when the distance clamp engages, MapKit ALSO drifts the visual
    // center — and the centerCoordinate it reports does NOT match what's at
    // the screen center (measured: reported NW while the view drifted SE).
    // There's no trustworthy actual to adopt, so the real fix is upstream:
    // updateCamera caps camera.scale on Apple-ground courses so the request
    // never dips under the flyover minimum (APPLE_MIN_DIST_M). The adopts
    // above are a second line of defense, not the primary mechanism.
  }
  const p = pitchDeg * Math.PI / 180;
  const h = -camera.angle;                       // compass heading, radians
  const sh = Math.sin(h), ch = Math.cos(h), sp = Math.sin(p), cp = Math.cos(p);
  // (An earlier lateral center-shift correction lived here — replaced by the
  // anchor-drop model in _apGroundZ. The drop itself is now ~0: the pivot
  // sits on MapKit's terrain model — see APPLE_ANCHOR_DROP_M for the
  // measurement story and how the old 23 m constant was a canopy artifact.)
  const P = {
    Ox, Oy, m, distM, reqDistM, reqPitch, reqLat, reqLon, cssH,
    // Terrain reference: the camera anchors against the flyover terrain at
    // the look-at point, so every overlay vertex projects with its DEM
    // height RELATIVE to the terrain there (see _apPt). Without this the
    // overlay is a flat sheet through O's altitude — greens/tees on any
    // slope render displaced ("floating") off the 3D ground.
    zAnchor: terrainZ(Ox, Oy),
    heading: ((h * 180 / Math.PI) % 360 + 360) % 360,
    pitch: pitchDeg,
    // camera position (ENU metres, origin at O): behind the look direction,
    // lifted by cos(pitch)
    px: -distM * sp * sh, py: -distM * sp * ch, pz: distM * cp,
    // orthonormal camera basis: right, up, forward
    rx: ch, ry: -sh, rz: 0,
    ux: sh * cp, uy: ch * cp, uz: sp,
    fx: sp * sh, fy: sp * ch, fz: -cp,
    focal: (cssH / 2) / Math.tan(15 * Math.PI / 180),
    cx: cssW / 2, cy: cssH / 2,
  };
  // Calibration: fit a screen affine from the raw replica onto the probe
  // annotations' ACTUAL rendered positions (see _appleCal). The fit input
  // predictions use P WITHOUT calA (appleProjPt applies calA only once it's
  // attached below), so the affine always maps raw-replica -> real-map and
  // never feeds back through itself. Eased via _calS; decays to identity
  // when probes go stale so a bad frame can't stick.
  let fitA = null, fitB = null;
  const cal = _appleCal;
  const hdgDiff = cal ? Math.abs(((cal.P.heading - P.heading) % 360 + 540) % 360 - 180) : 999;
  if (cal && cal.ll.length === 3 &&
      Math.abs(cal.P.reqDistM - reqDistM) < reqDistM * 0.25 &&
      Math.abs(cal.P.pitch - pitchDeg) < 10 && hdgDiff < 10 &&
      performance.now() - cal.t < 1500) {
    const g = course.geo.toLonLat;
    const gdet = g[0] * g[4] - g[1] * g[3] || 1;
    // Predict through the RAW replica of the camera the answers were made
    // for (cal.P, calibration stripped) — not the current frame's camera.
    // The affine then maps raw-replica -> map for that shared camera state,
    // which transfers cleanly to this frame (anchor state is what persists
    // between syncs; the camera itself may have moved a frame's worth).
    const calP = Object.assign({}, cal.P, { calA: null, calB: null });
    let S = [], D = [];
    for (let i = 0; i < cal.ll.length; i++) {
      const lat = cal.ll[i][0], lon = cal.ll[i][1];
      const wx = (g[4] * (lon - g[2]) - g[1] * (lat - g[5])) / gdet;
      const wy = (g[0] * (lat - g[5]) - g[3] * (lon - g[2])) / gdet;
      const q = appleProjPt(calP, wx, wy, _apGroundZ(calP, wx, wy));
      S.push(q); D.push({ x: cal.px[i], y: cal.py[i] });
    }
    // Least-squares affine over all probes (4 sent = overdetermined), then
    // one round of outlier rejection: annotation answers occasionally glitch
    // for a frame, and mesh refinement can slide ONE probe's terrain-anchored
    // position while the ground truth at the pin never moved — an exact
    // 3-point fit folds either straight into shear and visibly wobbles the
    // overlay mid-transition. Drop the worst residual > 5 px and refit.
    const lsq = (pts, ans) => {
      let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = pts.length;
      let bx = [0, 0, 0], by = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        const p = pts[i], d = ans[i];
        sxx += p.x * p.x; sxy += p.x * p.y; syy += p.y * p.y; sx += p.x; sy += p.y;
        bx[0] += p.x * d.x; bx[1] += p.y * d.x; bx[2] += d.x;
        by[0] += p.x * d.y; by[1] += p.y * d.y; by[2] += d.y;
      }
      // solve symmetric 3x3 [sxx sxy sx; sxy syy sy; sx sy n] m = b (Cramer)
      const M = [sxx, sxy, sx, sxy, syy, sy, sx, sy, n];
      const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
      if (Math.abs(det) < 1e6) return null;  // near-collinear
      const solve3 = (b) => {
        const r = [];
        for (let c = 0; c < 3; c++) {
          const T = M.slice();
          T[c] = b[0]; T[c + 3] = b[1]; T[c + 6] = b[2];
          r.push((T[0] * (T[4] * T[8] - T[5] * T[7]) - T[1] * (T[3] * T[8] - T[5] * T[6]) + T[2] * (T[3] * T[7] - T[4] * T[6])) / det);
        }
        return r;
      };
      return { X: solve3(bx), Y: solve3(by) };
    };
    let f = lsq(S, D);
    if (f && S.length > 3) {
      let worst = -1, wr = 0;
      for (let i = 0; i < S.length; i++) {
        const rx = f.X[0] * S[i].x + f.X[1] * S[i].y + f.X[2] - D[i].x;
        const ry = f.Y[0] * S[i].x + f.Y[1] * S[i].y + f.Y[2] - D[i].y;
        const r = Math.hypot(rx, ry);
        if (r > wr) { wr = r; worst = i; }
      }
      if (wr > 5) {
        S = S.filter((_, i) => i !== worst);
        D = D.filter((_, i) => i !== worst);
        f = lsq(S, D) || f;
      }
    }
    if (f) {
      const [a, b, tx] = f.X, [d, e, ty] = f.Y;
      const sdet = a * e - b * d;
      // Sanity: near-identity-ish (anchor shifts translate; scale/rot stay small)
      if (sdet > 0.5 && sdet < 2 && Math.hypot(tx, ty) < 500) {
        fitA = [a, b, d, e]; fitB = [tx, ty];
      }
    }
  }
  // Median-of-3 over recent fit targets: a single garbage fit (annotation
  // layout race, probe glitch that dodged outlier rejection) can pass every
  // per-fit sanity gate — measured ±90-170 css px one-frame spikes during
  // zoom. The median passes genuine anchor re-rolls after one extra sync
  // (~30 ms) and discards loners entirely.
  if (fitA) {
    _fitHist.push({ a: fitA, b: fitB, t: performance.now() });
    if (_fitHist.length > 3) _fitHist.shift();
  }
  const fresh = _fitHist.filter((h) => performance.now() - h.t < 400);
  if (fitA && fresh.length === 3) {
    const med = (v0, v1, v2) => Math.max(Math.min(v0, v1), Math.min(Math.max(v0, v1), v2));
    fitA = fitA.map((_, i) => med(fresh[0].a[i], fresh[1].a[i], fresh[2].a[i]));
    fitB = fitB.map((_, i) => med(fresh[0].b[i], fresh[1].b[i], fresh[2].b[i]));
  }
  // Ease toward the fit (or back to identity when none) — snap when close.
  // Probe answers are stable at rest (jitter feeders fixed in bcdef62), so
  // the ease is only smoothing anchor re-rolls and ramp chase — keep it firm.
  const tgtA = fitA || [1, 0, 0, 1], tgtB = fitB || [0, 0];
  // Adaptive rate: a far target means the anchor just RE-ROLLED (the map
  // content itself jumped) — snap most of the way in one frame so the
  // overlay lands with it, instead of visibly sliding after it. Near
  // targets keep the gentle rate that smooths probe answer granularity.
  const gap = Math.hypot(tgtB[0] - _calS.b[0], tgtB[1] - _calS.b[1]);
  const k = gap > 6 ? 0.85 : 0.5;
  for (let i = 0; i < 4; i++) _calS.a[i] += (tgtA[i] - _calS.a[i]) * k;
  for (let i = 0; i < 2; i++) _calS.b[i] += (tgtB[i] - _calS.b[i]) * k;
  const active = Math.abs(_calS.a[0] - 1) + Math.abs(_calS.a[3] - 1) + Math.abs(_calS.a[1]) + Math.abs(_calS.a[2]) > 1e-4 ||
                 Math.abs(_calS.b[0]) + Math.abs(_calS.b[1]) > 0.05;
  if (active) { P.calA = _calS.a.slice(); P.calB = _calS.b.slice(); }
  return P;
}
// Project world (x, y[, height in world units]) through the Apple pinhole,
// then through the probe-calibration affine when one is fitted (P.calA/calB).
function appleProjPt(P, x, y, z) {
  const e = (x - P.Ox) * P.m, n = (P.Oy - y) * P.m, u = (z || 0) * P.m;
  const vx = e - P.px, vy = n - P.py, vz = u - P.pz;
  const zc = vx * P.fx + vy * P.fy + vz * P.fz;          // depth along look dir
  const d = zc > 1 ? zc : 1;                              // clamp behind-camera blowups
  let sx = P.cx + P.focal * (vx * P.rx + vy * P.ry + vz * P.rz) / d;
  let sy = P.cy - P.focal * (vx * P.ux + vy * P.uy + vz * P.uz) / d;
  const A = P.calA;
  if (A) {
    const tx = A[0] * sx + A[1] * sy + P.calB[0];
    sy = A[2] * sx + A[3] * sy + P.calB[1];
    sx = tx;
  }
  return { x: sx, y: sy };
}
// Inverse: screen px -> world point on the TERRAIN (undo the calibration
// affine, ray cast onto the anchor plane, then two fixed-point refinements
// against the DEM — the same trick screenToWorldGround uses, and plenty
// since terrain varies slowly at overlay scales).
function appleUnproject(P, sx, sy) {
  const A = P.calA;
  if (A) {
    const det = A[0] * A[3] - A[1] * A[2] || 1;
    const ux = sx - P.calB[0], uy = sy - P.calB[1];
    sx = (A[3] * ux - A[1] * uy) / det;
    sy = (A[0] * uy - A[2] * ux) / det;
  }
  const dx = P.fx + (P.rx * (sx - P.cx) - P.ux * (sy - P.cy)) / P.focal;
  const dy = P.fy + (P.ry * (sx - P.cx) - P.uy * (sy - P.cy)) / P.focal;
  const dz = P.fz + (P.rz * (sx - P.cx) - P.uz * (sy - P.cy)) / P.focal;
  if (dz >= -1e-9) return { x: P.Ox, y: P.Oy };  // ray never descends — degenerate
  let uM = 0; // target plane height (metres above the anchor plane)
  let out = { x: P.Ox, y: P.Oy };
  for (let i = 0; i < 3; i++) {
    const t = (uM - P.pz) / dz;
    const e = P.px + t * dx, n = P.py + t * dy;
    out = { x: P.Ox + e / P.m, y: P.Oy - n / P.m };
    uM = _apGroundZ(P, out.x, out.y) * P.m;
  }
  return out;
}
function syncAppleGround() {
  const P = window.Capacitor.Plugins.CourseMap3D;
  if (!_appleGroundEntered) {
    _appleGroundEntered = true;
    // The native map sits BEHIND the WKWebView — the webview is made
    // non-opaque on the Swift side (CourseMap3DLayer.enter), but the page's
    // own CSS background (html/body paint --green-900, base.css) still
    // composites over it. Clear both while the map is the ground layer or
    // it shows as a solid pine rectangle.
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    P.enter({ courseId: course.id }).catch((e) => console.error("CourseMap3D enter", e));
  }
  const now = performance.now();
  // ~30fps cap over the native bridge — except while the camera is moving
  // (pitch tween, pan, aim, zoom: _apSettleN counts parked frames), where
  // probe answers age fastest: sync every frame there so the calibration
  // chases the motion instead of trailing it (measured ~27 css px pin spikes
  // at pan onsets on 30 Hz answers; pitch ramp same story).
  const tweening = Math.abs(applePitch - applePitchT) > 0.5 || _apSettleN < 3;
  if (now - _lastAppleSync < (tweening ? 15 : 33)) return;
  _lastAppleSync = now;
  // One camera model, one source: the same numbers the overlay projection
  // uses this frame (flat mode builds them fresh here — appleProj is null).
  const cam = view.appleProj || buildAppleProj(window.innerWidth, window.innerHeight);
  // Pitched: pick 3 well-spread ground probes (fixed screen triangle,
  // unprojected to world -> lat/lon). Their lat/lons are exact by
  // construction — the Swift side answers with where MapKit REALLY renders
  // them (invisible annotation views), and buildAppleProj fits the overlay
  // onto those answers. Flat view needs no probes (affine already exact).
  const probes = [];
  if (cam.reqPitch > 0.05) {
    const g = course.geo.toLonLat;
    const cssW = window.innerWidth, cssH = window.innerHeight;
    // Unproject through the RAW replica — cam carries the previous fit's
    // calA, and probing through it moves the probe points every time the
    // fit moves: the fit then samples different local error, moves again,
    // and the overlay visibly oscillates (~5 Hz, ±7 px measured). Cal-free
    // probes depend only on the camera, so a parked camera asks about the
    // SAME three coordinates every sync.
    const raw = Object.assign({}, cam, { calA: null, calB: null });
    // 4 probes, not 3: the fit is least-squares with one outlier-rejection
    // round (see buildAppleProj) — a glitched or mesh-drifted answer needs
    // redundancy to be identifiable at all.
    // STICKY coordinates: reuse the previous probe lat/lons while they still
    // project into the mid-viewport. Respawning from the screen triangle
    // every sync means every zoom/pan frame MOVES the annotations, and a
    // moved annotation can be read before MapKit re-lays it out — a stale
    // center paired with a new coordinate is a garbage answer (measured:
    // ±90-170 css px calibration spikes during zoom). Static coordinates
    // can't race their own layout.
    let reuse = null;
    if (_probeLL && _probeLL.length === 4) {
      reuse = _probeLL;
      for (const w of _probeLLW) {
        const q = appleProjPt(raw, w.x, w.y, _apGroundZ(raw, w.x, w.y));
        if (q.x < cssW * 0.08 || q.x > cssW * 0.92 || q.y < cssH * 0.12 || q.y > cssH * 0.92) { reuse = null; break; }
      }
    }
    if (reuse) {
      probes.push(...reuse);
    } else {
      _probeLL = []; _probeLLW = [];
      for (const [fx, fy] of [[0.3, 0.33], [0.7, 0.33], [0.25, 0.75], [0.75, 0.75]]) {
        const w = appleUnproject(raw, fx * cssW, fy * cssH);
        _probeLLW.push(w);
        _probeLL.push([g[3] * w.x + g[4] * w.y + g[5], g[0] * w.x + g[1] * w.y + g[2]]);
      }
      probes.push(..._probeLL);
    }
  }
  // Send the REQUESTED camera; record what MapKit actually applied (its
  // clamps) so the next frame's overlay projection can match the real map.
  P.syncCamera({ lat: cam.reqLat, lon: cam.reqLon, heading: cam.heading, distM: cam.reqDistM, pitch: cam.reqPitch, probes })
    .then((a) => {
      if (a && typeof a.distM === "number") {
        _appleActualCam = { lat: a.lat, lon: a.lon, distM: a.distM, pitch: a.pitch, heading: a.heading,
                            reqLat: cam.reqLat, reqLon: cam.reqLon,
                            reqDistM: cam.reqDistM, reqPitch: cam.reqPitch };
      }
      if (a && probes.length >= 3 && Array.isArray(a.px) && a.px.length === probes.length &&
          a.px.every(isFinite) && a.py.every(isFinite)) {
        // Keep the REQUEST camera with the answers: the fit must compare
        // them against predictions from THIS camera, not whatever frame the
        // fit runs on — during the 2D->3D pitch ramp the camera moves ~2°
        // per sync, and comparing stale answers against current-frame
        // predictions folds that motion into the correction (measured: pin
        // transiently ~13 css px off mid-transition, then snapping back).
        _appleCal = { ll: probes, px: a.px, py: a.py, P: cam, t: performance.now() };
      }
    })
    .catch(() => {});
}
// --- Apple-ground green detail gating ---------------------------------
// OSM green polygons and Apple's imagery never register perfectly (different
// georeferencing), and mid camera-move the overlay/map lag each other — a
// half-offset green tint mid-transition reads as broken. So the full green
// treatment (tint + contours + relief + flow dots) only draws when it can be
// trusted AND is useful: the pin is within the current club's reach, and the
// camera has fully settled. Out of range / in motion, the green shows just
// cup + flag (drawn elsewhere) — also skipping the most projection-heavy
// overlay work every frame the player is only looking at the hole.
let _apSettleN = 0;    // consecutive settled camera frames (updateCamera)
let _apDetailA = 0;    // green-detail fade alpha (eases in after settle)
function appleGreenDetailWanted() {
  if (state.moving || cine || greenView) return false;
  const c = TUNE.clubs[selectedClub];
  const reach = c ? c.carry + 30 : 120;   // carry + generous rollout (putter: near the green anyway)
  const toPin = dist(state.ball.x, state.ball.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT;
  return toPin <= reach && _apSettleN >= 12;   // ~200ms parked before it appears
}
function leaveAppleGround() {
  if (!_appleGroundEntered) return;
  _appleGroundEntered = false;
  _appleActualCam = null;
  _appleCal = null;
  _calS.a = [1, 0, 0, 1]; _calS.b = [0, 0];
  _probeLL = _probeLLW = null; _fitHist.length = 0;
  _apSettleN = 0; _apDetailA = 0;
  document.documentElement.style.background = "";
  document.body.style.background = "";
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CourseMap3D;
  if (P) P.leave().catch(() => {});
}
// Tournament state — set when player enters a tournament round via the lobby.
let activeTournament = null;     // full tournament row from Supabase
let activeTournamentRound = null; // 1-4, which round the player is currently playing
let tourEventName = null;         // name of the real PGA Tour event being played (Live PGA Tour)
let _tourCourseId = null;         // baked course id of this week's tour venue — plays free (see isTourFeatured)
// Tour Events (spectator leaderboard + compete-against-the-pros; see "Tour Events").
let tourPlayMode = false;         // true while playing a round that counts toward the followed tour event
let _tourLbCache = null;          // { at, data } short-TTL cache of the live leaderboard
let _tourPoll = null;             // setInterval handle for live leaderboard polling
let _tourExpanded = false;        // full-screen board: show full field vs leaders only
// Match state — live head-to-head game with friends (see "Multiplayer matches").
let activeMatch = null;      // full matches row from Supabase (null when not in a match)
let matchHoleCount = 18;     // holes this match plays (9 or 18), set at Begin
let matchSetupMode = false;  // host is picking course/settings for a match
let _matchEntered = false;   // guard so we only drop into the live round once
let matchDecided = false;    // 1v1 match-play closeout reached → stop advancing holes
// Quick Match (open matchmaking) — CPU fallback plays a purely local opponent
// (no Supabase row); cpuOpp is a synthetic match_players row filled hole-by-hole.
let cpuMatch = false;        // true → the "opponent" is a local bot, not a DB player
let cpuOpp = null;           // synthetic match_players-shaped row for the bot
function matchLive() { return !!(activeMatch && activeMatch.status === "live"); }
function matchPlay() { return matchLive() && activeMatch.format === "match"; }
// Any match context (online/live match or a local CPU match) — used to lock a
// match to a single scored pass: a hole recorded here can't be replayed.
function inMatch() { return matchLive() || cpuMatch; }
// Live (synchronous) match — enforce honors/away turn order, render the
// opponent's ball, watch each shot live. Online matches only set live=true for
// match play (beginMatch); local Quick Match opponents are live in both formats.
function liveMatch() { return matchLive() && !!activeMatch.live; }
let holeTransition = null; // active hole-change animation (fade + zoom-in), or null
let holeDrop = null;       // active ball-into-cup drop animation, or null
const HOLE_DROP_MS = 520;  // drop animation length; result modal opens when it ends
let measureMode = false;   // range-finder: drag to measure distance from ball & pin
let showSlope = true;      // slope relief overlay — ON by default (toggle in HUD menu)
let showOOB = true;        // red OOB overlay toggle
let greenView = null;      // 3D green inspect overlay — { g, mesh, yaw, tilt, drag } or null
// Cinematic 3D landing (auto green view on a great approach — see TUNE.cine*).
let cine = null;           // active cinematic — { g, mesh, t0, yaw0, tilt, restT } or null
let cinePending = null;    // armed at launch by a great predicted shot; opens on the descent
let cineEnabled = lsGet("golf.cineLanding", true); // per-device toggle (HUD menu)
// Slope-mode style: false = flow dots (default), true = static fall-line arrows.
// Per-device cosmetic preference (localStorage), not a tournament setting.
let breakArrows = lsGet("golf.breakArrows", false);
let tiltView = lsGet("golf.tiltView", false); // slightly-3D tilted course camera (HUD button)
let slottedMode = false;   // cheat: ball steers to hole automatically
let autoAimEnabled = true; // re-aim camera at the pin after each shot (off = manual aim, harder)
let chipEnabled = true;    // greenside chip mode: near the pin, swipe power maps to pin distance
let chipSpinBias = 0;      // chip spin slider (-1 run .. 0 neutral .. +1 bite); resets to 0 each hole
let flightBias = 0;        // full-shot FLIGHT slider (0 stock .. 1 high spinner); one-shot, resets after the swing
let lieEffectEnabled = true; // rough/sand cost power + spin (off = every lie plays clean, easier)
let shotPreviewEnabled = false; // live predicted-landing marker while swinging (HUD menu, tournament-synced)
let measurePoint = null;   // world {x,y} of the dropped range-finder marker
let markerDropT = 0;       // when the marker was tap-dropped (grace vs insta-dismiss)
let measureDragging = false;
let markerDrag = null;     // active drag of the dropped marker: { moved, x, y } (screen px)
const MARKER_HIT_PX = 22;  // touch/click radius around the marker to grab/dismiss it
let selectedClub = "driver"; // driver | iron | wedge (putter auto on the green)
let rangeTarget = 150; // driving-range target distance (yards)
let wind = { dir: 0, speed: 0 }; // dir = compass bearing wind comes FROM (radians, 0=N), speed in mph
// Last-shot stats for the HUD (carry / ball speed / total / dist-to-pin).
const shot = { startX: 0, startY: 0, mph: 0, carry: null, total: null, carried: false };

// =====================================================================
//  Geometry helpers (pure)
// =====================================================================
function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}
// Shortest distance from point P to segment A->B (for swept hole capture).
function segPointDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// ray-casting point-in-polygon
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit = (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
function inAnyPoly(x, y, polys) {
  if (!polys) return false;
  for (let i = 0; i < polys.length; i++) {
    if (pointInPoly(x, y, polys[i])) return true;
  }
  return false;
}
// --- Aerial surface mask ---------------------------------------------------
// A baked per-pixel label raster classified straight from the aerial photo
// (fairway / rough / woods / out-of-bounds), so OOB + fairway/rough match what
// the player SEES instead of patchy OSM polygons. surfaceAt() samples it.
const MASK_CLASS = ["ob", "fairway", "rough", "woods"];   // palette index -> surface
// palette RGB — MUST match MASK_PALETTE in tools/fetch_course.py
const MASK_PALETTE = [[200, 40, 40], [150, 210, 90], [60, 130, 55], [25, 60, 30]];
function nearestMaskIdx(r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < MASK_PALETTE.length; i++) {
    const p = MASK_PALETTE[i];
    const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function invertAffine(t) {
  const [a, b, c, d, e, f] = t, det = a * e - b * d;
  if (Math.abs(det) < 1e-12) return null;
  const ia = e / det, ib = -b / det, id = -d / det, ie = a / det;
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)]; // world -> px
}
// Decode the mask PNG once -> { w, h, lab:Uint8Array, w2p:[..] }; calls onReady.
function loadSurfaceMask(maskRec, onReady) {
  if (!maskRec || !maskRec.file || typeof Image === "undefined") return;
  const w2p = invertAffine(maskRec.toWorld);
  if (!w2p) return;
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.drawImage(img, 0, 0);
    const px = c.getImageData(0, 0, w, h).data, lab = new Uint8Array(w * h);
    for (let i = 0; i < lab.length; i++) lab[i] = nearestMaskIdx(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    // Woods carries the OB penalty, but a WOODS cell bordering playable turf is
    // usually tree canopy overhanging fairway/rough/green fringe (shade reads
    // "dark + textured" to the classifier) — a mask cell is ~4-5 yds, so that
    // fringe misfires on shots that are clearly in play. Erode 1 cell: keep
    // WOODS only where the whole 4-neighborhood is woods/OB (deep forest),
    // demote the rest to ROUGH. Off-raster neighbors count as woods.
    const raw = lab.slice();
    const rawAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 3 : raw[y * w + x];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (raw[i] !== 3) continue;
        const deep = (rawAt(x - 1, y) === 3 || rawAt(x - 1, y) === 0) &&
                     (rawAt(x + 1, y) === 3 || rawAt(x + 1, y) === 0) &&
                     (rawAt(x, y - 1) === 3 || rawAt(x, y - 1) === 0) &&
                     (rawAt(x, y + 1) === 3 || rawAt(x, y + 1) === 0);
        if (!deep) lab[i] = 2;
      }
    }
    // pre-render a red tint canvas over the OOB + woods cells (drawn through the
    // aerial-style transform when the OB overlay is on)
    const oob = document.createElement("canvas"); oob.width = w; oob.height = h;
    const oc = oob.getContext("2d"), od = oc.createImageData(w, h);
    for (let i = 0; i < lab.length; i++) {
      if (lab[i] === 0 || lab[i] === 3) { // OB or WOODS (both out of bounds)
        od.data[i * 4] = 200; od.data[i * 4 + 1] = 45; od.data[i * 4 + 2] = 45; od.data[i * 4 + 3] = 55;
      }
    }
    oc.putImageData(od, 0, 0);
    // `raw` keeps pre-erosion WOODS (canopy incl. overhang) — tree placement
    // wants the trees you SEE, not just the deep forest that carries the penalty.
    onReady({ w, h, lab, canopy: raw, w2p, toWorld: maskRec.toWorld, oob });
  };
  img.src = "courses/" + maskRec.file;
}
// Surface class at a world point from the mask, or null (no mask / off image).
function maskClassAt(x, y) {
  const m = HOLE && HOLE._mask;
  if (!m) return null;
  const t = m.w2p;
  const px = Math.round(t[0] * x + t[1] * y + t[2]);
  const py = Math.round(t[3] * x + t[4] * y + t[5]);
  if (px < 0 || py < 0 || px >= m.w || py >= m.h) return null;
  return MASK_CLASS[m.lab[py * m.w + px]];
}

// Surfaces tested by priority: a hazard wins over the grass it sits on, etc.
// Greens/bunkers/water/tees come from crisp OSM polygons; fairway/rough/woods/OOB
// come from the aerial mask (what the player sees > OSM), with OSM as a fallback
// for offline / vector holes that have no mask.
function surfaceAt(x, y) {
  const s = HOLE.surfaces;
  if (inAnyPoly(x, y, s.water)) return "water";
  if (inAnyPoly(x, y, s.bunker)) return "bunker"; // sand
  if (inAnyPoly(x, y, s.green)) return "green";
  if (inAnyPoly(x, y, s.tee)) return "fairway";   // tee boxes play like fairway
  // Teeing ground is always clean lie: back tees can be unmapped in OSM
  // (hole tee set from imagery, or the bake's card-yardage stretch) and the
  // surface mask often calls those tree-lined chutes "woods" — a -50% power
  // lie penalty on the tee shot. Small radius so it never leaks into play.
  if (HOLE.teePos && dist(x, y, HOLE.teePos.x, HOLE.teePos.y) < 2.5) return "fairway";
  // The mask decides OB vs playable first: its bake envelope already unions the
  // boundary polygon with the hole corridors + OSM play polygons and rescues
  // dune/waste sand, so it knows parcel lines cut through real play areas
  // (coastal / multi-parcel courses) where the raw boundary would call OB.
  const m = maskClassAt(x, y);
  if (m) return m;                                // fairway | rough | woods | ob
  // Off-mask / no-mask: real OB = outside the course-boundary polygon
  // (vector-exact) — except a mapped fairway past the line still plays.
  if (HOLE._boundary && !inAnyPoly(x, y, HOLE._boundary) &&
      !inAnyPoly(x, y, s.fairway)) return "ob";
  // no mask: fall back to OSM polygons
  if (inAnyPoly(x, y, s.fairway)) return "fairway";
  if (inAnyPoly(x, y, s.woods)) return "woods";   // trees = out of bounds (penalty)
  if (s.rough && inAnyPoly(x, y, s.rough)) return "rough";
  return "rough";
}
// Downhill slope (gradient of the height field) at a point on a green, or null.
// Same field that draws the contours → what you see is what breaks.
function greenSlopeAt(x, y) {
  for (const g of HOLE._greens || []) {
    if (g.grad && pointInPoly(x, y, g.poly)) return g.grad(x, y);
  }
  return null;
}
// Synthetic green-field height at a point (same field that breaks), or null off-green.
function greenHeightAt(x, y) {
  for (const g of HOLE._greens || []) {
    if (g.h && pointInPoly(x, y, g.poly)) return g.h(x, y);
  }
  return null;
}
// Elevation at a world point in feet.
// With a baked DEM: available everywhere on the course (fairway, rough, etc.).
// Without a DEM: green-only, ±3ft relative to that green's midpoint.
// Returns null if no elevation data is available for this point.
function terrainElevAt(x, y) {
  if (HOLE._dem) return HOLE._dem.elevAt(x, y) * 3.28084;  // metres → feet
  for (const g of HOLE._greens || []) {
    if (!pointInPoly(x, y, g.poly)) continue;
    const hMid = (g.hmin + g.hmax) / 2;
    const hHalf = (g.hmax - g.hmin) / 2 || 1;
    return (g.h(x, y) - hMid) / hHalf * 3.0;
  }
  return null;
}
// Caddie distance from a world point to the pin: the flat yardage plus an elevation
// "plays like" correction (uphill plays longer). dz is climb to the pin in feet
// (null DEM/green → plays == flat). Mirrors how a caddie reads a yardage book.
function playsLikeYards(fromX, fromY) {
  const flat = dist(fromX, fromY, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT;
  const eBall = terrainElevAt(fromX, fromY), ePin = terrainElevAt(HOLE.holePos.x, HOLE.holePos.y);
  const dz = (eBall == null || ePin == null) ? null : ePin - eBall;   // feet of climb to the pin
  const plays = dz == null ? flat : flat + dz * TUNE.playsLikePerFoot;
  return { flat, plays, dz };
}

// Elevation-adjusted carry (world units) for a full shot: shorten uphill / extend
// downhill so the ball actually finishes at the plays-like distance the HUD shows.
// Marches down the aim line to the landing point and applies the SAME playsLikePerFoot
// climb the caddie number uses — so a club's rated carry becomes a plays-like carry,
// and a pin whose plays-like == your carry is reached (works for any aim, not just the
// pin). No elevation data (null DEM off-green) -> unchanged (flat), matching the HUD.
function elevAdjustCarry(sx, sy, ang, Cflat) {
  const e0 = terrainElevAt(sx, sy);
  if (e0 == null) return Cflat;
  const k = TUNE.playsLikePerFoot / YARDS_PER_UNIT;  // carry units lost per foot of climb
  const cos = Math.cos(ang), sin = Math.sin(ang);
  let C = Cflat;
  for (let i = 0; i < 2; i++) {                       // 2 iters converge on smooth terrain
    const e1 = terrainElevAt(sx + cos * C, sy + sin * C);
    if (e1 == null) return Cflat;
    C = Math.max(Cflat * 0.3, Cflat - (e1 - e0) * k); // uphill shorter; guard against collapse
  }
  return C;
}

// =====================================================================
//  Physics
// =====================================================================
function update() {
  if (!state.moving || state.inHole) return;
  if (state.airborne) flightStep(state.ball);
  else rollStep(state.ball);
}

// Keep the ball inside the play area (gentle bounce off the boundary walls).
function clampToWorld(b) {
  if (b.x < 1) { b.x = 1; b.vx *= -0.5; }
  if (b.x > WORLD.w - 1) { b.x = WORLD.w - 1; b.vx *= -0.5; }
  if (b.y < 1) { b.y = 1; b.vy *= -0.5; }
  if (b.y > WORLD.h - 1) { b.y = WORLD.h - 1; b.vy *= -0.5; }
}

// Airborne dispatch: the initial shot follows the per-club arc (state.flight);
// any subsequent bounce is plain ballistic (gravity).
function flightStep(b) {
  if (state.flight) arcFlightStep(b);
  else ballisticFlightStep(b);
}

// Set up a per-club arc to hit `C` carry, `H` max height, `L` land angle (world
// units / radians). Two parabolas (ascent->apex->descent) make the descent
// steeper than the ascent, exactly like a real spinning ball.
// Pure half of setupFlight: computes the flight descriptor + initial ball
// velocity/height WITHOUT touching state.flight or the ball. Used both by
// setupFlight below (the real, committed launch) and by buildTrialShot (a
// hypothetical, discarded-after-simShotRest preview).
function buildFlight(ang, C, H, L, spinN) {
  H = Math.max(H, 0.001);
  let xa = C - 2 * H / Math.tan(L);          // apex horizontal position
  xa = Math.max(xa, C * 0.15);               // guard (steep, short shots)
  const T = 2 * Math.sqrt(2 * H / TUNE.gravity); // hang time in frames (apex-based)
  const vh = C / Math.max(T, 1);             // constant horizontal speed
  return { flight: { ang, C, H, xa, L, vh, d: 0, spinN: spinN || 0 },
           vx: Math.cos(ang) * vh, vy: Math.sin(ang) * vh, z: 0.0001, vz: 0 };
}
function setupFlight(b, ang, C, H, L, spinN) {
  const r = buildFlight(ang, C, H, L, spinN);
  state.flight = r.flight;
  b.vx = r.vx; b.vy = r.vy; b.z = r.z; b.vz = r.vz;
}

function arcFlightStep(b) {
  const fl = state.flight;
  fl.d += fl.vh;
  b.x += b.vx;
  b.y += b.vy;
  // sidespin curves the path (draw/fade); keep the arc advancing along its length
  if (b.spin) {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const px = -b.vy / sp, py = b.vx / sp;
    const a = b.spin * TUNE.spinFactor * sp;
    b.vx += px * a; b.vy += py * a;
  }
  // wind: horizontal push (world space). dir = compass FROM bearing. A flighted
  // high ball (fl.windMul) hangs longer and rides the wind harder.
  if (wind.speed > 0) {
    const we = TUNE.windEffect * (fl.windMul || 1);
    b.vx -= Math.sin(wind.dir) * wind.speed * we;
    b.vy += Math.cos(wind.dir) * wind.speed * we;
  }
  // height from the two-parabola arc
  const d = fl.d, C = fl.C, H = fl.H, xa = fl.xa;
  const t = d <= xa ? (d - xa) / xa : (d - xa) / (C - xa);
  const prevz = b.z;
  b.z = Math.max(H * (1 - t * t), 0);
  b.vz = b.z - prevz; // for the shadow/trail render
  clampToWorld(b);

  if (d >= C || (d > xa && b.z <= 0)) {
    // landed — record carry, then hand off to the surface bounce/roll
    b.z = 0;
    if (!shot.carried) {
      shot.carry = dist(shot.startX, shot.startY, b.x, b.y) * YARDS_PER_UNIT;
      shot.carried = true;
    }
    // slotted club lands exactly at the hole — sink it
    if (slottedMode && !HOLE.isRange) {
      state.flight = null; state.airborne = false;
      b.x = HOLE.holePos.x; b.y = HOLE.holePos.y;
      b.vx = 0; b.vy = 0; b.vz = 0;
      state.moving = false; state.inHole = true;
      beginHoleDrop(HOLE.holePos.x, HOLE.holePos.y, 0, -0.03);
      return;
    }
    const surf = surfaceAt(b.x, b.y);
    const sp = Math.hypot(b.vx, b.vy) || 1, dx = b.vx / sp, dy = b.vy / sp; // travel dir
    // Touchdown thud (the arc path never bounces, so without this a normal shot
    // lands silently). Downward impact speed from the arc's descent slope.
    const down = fl.vh * Math.tan(fl.L);
    if (!shot._landed) {
      playLand(surf === "ob" ? "woods" : surf, down);
      spawnBurst(b.x, b.y, surf === "water" ? "splash" : "dust");
      shot._landed = true;
    }
    haptic(Math.max(2, Math.round(down * 35)));  // same impact buzz as a ballistic bounce
    state.flight = null;
    if (surf === "water" || surf === "woods" || surf === "ob") {
      b.vx = b.vy = b.vz = 0; state.airborne = false;
      return;
    }
    const v = landingRelease(fl, b.spin, surf);
    b.vx = dx * v; b.vy = dy * v; b.vz = 0; b.spin = 0; state.airborne = false;
  }
}

// Landing release: how fast the ball leaves its first touchdown, signed along the
// travel direction (< 0 = spins back). Pure — shared by arcFlightStep AND the
// launch-time prediction (simShotRest), so the cinematic trigger can never drift
// from the real physics. Keep it side-effect free.
function landingRelease(fl, spin, surf) {
  // Backspin check: a spinning ball grabs on landing. Low spin (driver) releases
  // and runs; high spin on receptive turf (wedge -> green) checks, and can roll
  // BACKWARD. Rough is a flyer (little grip) so it releases. `Dr` = rollout (units).
  const grip = TUNE.spinGrip[surf] ?? 0.3;
  // Sidespin (spin = swipe curve) reduces effective backspin: draw runs, fade checks.
  // At max sidespin, 40% of backspin converts to sidespin → less check.
  const backspinRetained = Math.max(0, 1 - 0.4 * Math.abs(spin));
  // Descent steepness: the club's land angle (fl.L, radians) mapped to 0..1. Steep
  // landings (irons, 46–52°) grab even at mid-iron spin; shallow (driver ~39°) release.
  // Chips opt out (fl.noLandCheck) — their release is tuned purely by the spin slider.
  const landDeg = fl.L * 180 / Math.PI;
  const steep = fl.noLandCheck ? 0 :
    Math.max(0, Math.min(1, (landDeg - TUNE.checkLandRef) / TUNE.checkLandSpan));
  // Chips keep FULL spin weight (their bite is tuned by the spin slider alone);
  // full shots blend spin with steepness so mid/long irons hold like the tour.
  const spinW = fl.noLandCheck ? 1 : TUNE.checkSpinW;
  const check = Math.min(1.1,
    (spinW * fl.spinN + TUNE.checkLandW * steep) * backspinRetained * grip);
  const rollK = fl.noLandCheck ? TUNE.rolloutK : TUNE.rolloutKFull; // chips skid & release more
  let Dr = fl.vh * rollK * (1 - check * TUNE.spinCheckK); // <0 = spins back
  Dr = Math.max(Dr, -TUNE.spinBackMax); // a spun-back wedge sucks back a few yards, not off the green
  if (surf === "green") return Math.sign(Dr) * Math.sqrt(2 * TUNE.greenDecel * Math.abs(Dr));
  const fr = TUNE.friction[surf] ?? 0.9;
  // Cap at fl.vh * bounce[surf].h: the ball can't leave the landing point faster
  // than it arrived (fl.vh) times the surface landing grip (bo.h). Without this,
  // high-friction surfaces (bunker fr=0.55) produce huge initial v = Dr*(1-fr) that
  // shoots the ball off when it rolls off the edge onto low-friction fairway.
  const bo = TUNE.bounce[surf] ?? TUNE.bounce.fairway;
  return Math.min(Dr * (1 - fr), fl.vh * bo.h);
}

// --- Ballistic bounces after the first landing: projectile arc + land/settle ---
function ballisticFlightStep(b) {
  b.x += b.vx;
  b.y += b.vy;
  b.z += b.vz;
  const impactVz = b.vz; // velocity that carried the ball to this height THIS frame
  b.vz -= TUNE.gravity;  // (apply gravity after, so the landing test below uses impactVz)

  // sidespin curves the flight: accel perpendicular to travel, grows with speed
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > 1e-4 && b.spin) {
    const px = -b.vy / sp, py = b.vx / sp; // unit left-perpendicular
    const a = b.spin * TUNE.spinFactor * sp;
    b.vx += px * a;
    b.vy += py * a;
  }
  b.vx *= TUNE.airDrag;
  b.vy *= TUNE.airDrag;
  if (wind.speed > 0) {
    b.vx -= Math.sin(wind.dir) * wind.speed * TUNE.windEffect;
    b.vy += Math.cos(wind.dir) * wind.speed * TUNE.windEffect;
  }

  clampToWorld(b);

  // landing
  if (b.z <= 0) {
    b.z = 0;
    if (!shot.carried) { // first ground contact = carry distance
      shot.carry = dist(shot.startX, shot.startY, b.x, b.y) * YARDS_PER_UNIT;
      shot.carried = true;
    }
    const surf = surfaceAt(b.x, b.y);
    const down = -impactVz; // downward speed at impact (pre-gravity; using post-gravity vz
                            // double-counts a frame of gravity and creates a perpetual
                            // low-bounce limit cycle that never settles)
    if (surf === "water" || surf === "woods" || surf === "ob") {
      // splash / into the trees / out of bounds — kill it; roll-stop applies penalty
      playLand(surf === "ob" ? "woods" : surf, down);
      spawnBurst(b.x, b.y, surf === "water" ? "splash" : "dust");
      b.vx = b.vy = b.vz = 0;
      state.airborne = false;
    } else if (down > TUNE.bounceStopVz) {
      const bo = TUNE.bounce[surf] || TUNE.bounce.fairway;
      haptic(Math.max(2, Math.round(down * 35)));  // intensity scales with impact speed
      if (!shot._landed) { playLand(surf, down); spawnBurst(b.x, b.y, "dust"); shot._landed = true; }
      b.vz = down * bo.e;   // bounce back up
      b.vx *= bo.h;         // scrub/grab forward speed
      b.vy *= bo.h;
      b.spin *= 0.5;        // spin bleeds off with each bounce
    } else {
      // too low to bounce — settle and start rolling
      b.vz = 0;
      b.spin = 0;
      state.airborne = false;
    }
  }
}

// --- Grounded: roll with per-surface friction, hole capture, water penalty ---
function rollStep(b) {
  b.x += b.vx;
  b.y += b.vy;

  clampToWorld(b);

  const surf = surfaceAt(b.x, b.y);

  // First time on green this hole: capture proximity + GIR
  if (!HOLE.isRange && !state.greenReached && surf === "green") {
    state.greenReached = true;
    state.proximity = dist(b.x, b.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT;
    state.gir = state.strokesOffGreen <= HOLE.par - 2;
    if (showSlope && earnMilestone("hint-green"))
      showToast("Contours show the break · arrows point downhill", 2400, "gold");
  }
  if (surf === "green") {
    // Realistic green roll: subtract a constant deceleration from the speed
    // (not a multiplier), so the ball glides and then stops crisply.
    const sp = Math.hypot(b.vx, b.vy);
    const k = sp > 0 ? Math.max(0, sp - TUNE.greenDecel) / sp : 0;
    b.vx *= k;
    b.vy *= k;
    // Slope-aware break: accelerate downhill along the same synthetic green field
    // that draws the contours. Gated above a stop speed so a ball that comes to
    // rest on a slope stays put (the synthetic tilt can exceed greenDecel).
    if (sp > TUNE.slopeStopSpeed) {
      const g = greenSlopeAt(b.x, b.y);
      if (g) {
        const gm = Math.hypot(g.x, g.y);
        // Cap slope force to slopeCapFrac of greenDecel — guarantees a net decel on any
        // slope, so the ball can always stop even on the steepest green.
        const force = gm > 0 ? Math.min(TUNE.slopeAccel * gm, TUNE.greenDecel * TUNE.slopeCapFrac) / gm : 0;
        b.vx -= force * g.x; b.vy -= force * g.y;
      }
    }
  } else {
    const sp = Math.hypot(b.vx, b.vy);
    const f = TUNE.friction[surf];
    b.vx *= f;
    b.vy *= f;
    // Terrain slope on fairway/rough: roll downhill when DEM is available
    if (HOLE._dem && sp > TUNE.slopeStopSpeed) {
      const gv = HOLE._dem.gradAt(b.x, b.y);
      b.vx -= TUNE.fairwaySlopeAccel * gv.x;
      b.vy -= TUNE.fairwaySlopeAccel * gv.y;
    }
  }

  // slotted mode: steer rolling ball toward the hole
  if (slottedMode && !HOLE.isRange) {
    const thx = HOLE.holePos.x - b.x, thy = HOLE.holePos.y - b.y;
    const td = Math.hypot(thx, thy) || 0.01;
    b.vx = (thx / td) * TUNE.captureSpeed * 0.7;
    b.vy = (thy / td) * TUNE.captureSpeed * 0.7;
  }

  const speed = Math.hypot(b.vx, b.vy);

  // hole capture / lip-out (course only — the range has no cup). Test the ball's
  // PATH this frame against the cup (swept), so a putt rolling over the small
  // real-scale hole can't step past it between frames. Skip once the ball has
  // already lipped out this shot: a rammed lip-out hops the ball at the rim, and
  // re-testing capture every frame would re-trigger the hop in place forever
  // (ball stuck airborne over the cup, never settling → can't take the next shot).
  if (!HOLE.isRange && !state._lippedThisShot) {
    const cup = resolveCup(b, speed, state.airborne, Math.random);
    if (cup) {
      if (cup.holed) {
        // slow enough — drop in. Keep the entry point + heading so the ball can
        // visibly catch the lip, rattle to centre and sink; result modal waits for
        // the drop animation to finish (tickHoleDrop).
        state.moving = false;
        state.inHole = true;
        beginHoleDrop(b.x, b.y, b.vx, b.vy);
        b.vx = b.vy = 0;
        return;
      }
      // lip-out: too fast to drop — fire the sting once per shot. The toast is
      // redundant over the cinematic (the player is WATCHING the lip-out).
      state._lippedThisShot = true;
      playNearMiss();
      cameraPunch(0.018);
      if (!cine) showToast("So close!");
      if (cup.grounded) state.airborne = false;
      else if (cup.hop) state.airborne = true;
    }
  }

  // stopped
  if (speed < TUNE.stopThreshold) {
    b.vx = b.vy = 0;
    state.moving = false;
    shot.total = dist(shot.startX, shot.startY, b.x, b.y) * YARDS_PER_UNIT;
    // Fairway-hit: tee shot on par 4/5 — check where ball came to rest
    if (state._teeShot && !HOLE.isRange) {
      state._teeShot = false;
      state.fairwayHit = surfaceAt(b.x, b.y) === "fairway";
    }
    if (HOLE.isRange) {
      // range: report the shot, then tee up a fresh ball for the next swing
      const delta = Math.round(shot.total - rangeTarget);
      rangeFeedback(`Total ${Math.round(shot.total)} yds · ${delta >= 0 ? "+" : ""}${delta} to target`);
      b.x = HOLE.teePos.x; b.y = HOLE.teePos.y; b.z = 0; b.vz = 0; b.spin = 0;
      state.lastSafe = { x: b.x, y: b.y };
      frameRange();
      return;
    }
    const rest = surfaceAt(b.x, b.y);
    const isOB = rest === "woods" || rest === "ob"; // trees + out-of-bounds
    if (rest === "water" || (isOB && TUNE.obPenalty)) {
      // hazard / out of bounds: +1 penalty, drop at last safe spot — and SAY so
      // (a silent teleport reads as the game cheating)
      state.strokes += 1;
      penaltyAnim = { t0: performance.now(), fx: b.x, fy: b.y };
      b.x = state.lastSafe.x;
      b.y = state.lastSafe.y;
      playPenalty();
      haptic(14);
      showToast(rest === "water" ? "Water · +1 stroke" : "Out of bounds · +1 stroke", 2000, "warn");
    } else {
      state.lastSafe = { x: b.x, y: b.y };
      if (chipEnabled && rest !== "green" &&
          dist(b.x, b.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT < TUNE.chipRangeYds &&
          earnMilestone("hint-chip")) {
        showToast("Chip mode: a short swipe floats the ball to the flag", 2400, "gold");
      }
    }
    // reframe to fit the remaining shot and re-aim the camera up the line to the
    // pin (smoothly) so the next shot is already oriented toward the hole.
    frameRemaining();
    if (autoAimEnabled) aimAtHole();
    manualClubThisShot = false; // manual pick was for the shot just hit
    autoClub(); // pick the club for the next shot's distance to the pin
    updateScorecard();
    if (matchLive()) pushMatchShot();  // ball at rest → push hole/strokes/distance/lie
    checkHoleConcede();                // match play: dead hole? pick up and move on
  }
}

// Cup interaction for a rolling ball whose PATH this frame passed within capture
// range. Swept test (segPointDist) so a putt can't step over the small real-scale
// hole between frames. Mutates b on a lip-out (repositions past the far lip and
// re-paces / hops it). Pure of game state otherwise — shared by rollStep AND the
// launch-time prediction (simShotRest); `rand` is injected so the sim stays
// deterministic (the game passes Math.random, the sim a constant).
// Returns null (no interaction), { holed: true }, or { lip: true, grounded|hop }.
function resolveCup(b, speed, airborne, rand) {
  const px = b.x - b.vx, py = b.y - b.vy;            // last frame's position
  const capR = HOLE.holeRadius + BALL_RADIUS_UNITS;  // ball overlaps the cup edge
  const cd = segPointDist(HOLE.holePos.x, HOLE.holePos.y, px, py, b.x, b.y);
  if (cd > capR) return null;
  // Pace forgiveness: a grounded putt crossing near-dead-center (within 60% of the
  // cup radius) at a good — not rammed — pace is grabbed by the lip and drops, like
  // real life. Off-center / faster passes keep the strict captureSpeed → lip-out.
  const deadCenter = !airborne && cd < 0.6 * HOLE.holeRadius;
  const dropSpeed = deadCenter ? TUNE.captureAssist : TUNE.captureSpeed;
  if (speed < dropSpeed) return { holed: true };
  const spd = Math.hypot(b.vx, b.vy) || 0.01;
  const dx = b.vx / spd, dy = b.vy / spd;
  // place ball just past the far lip so it exits the capture zone this frame
  b.x = HOLE.holePos.x + dx * (HOLE.holeRadius + BALL_RADIUS_UNITS + 0.05);
  b.y = HOLE.holePos.y + dy * (HOLE.holeRadius + BALL_RADIUS_UNITS + 0.05);
  if (spd <= TUNE.lipOutMaxSpeed) {
    // catchable pace: the lip grabs it. Re-pace so it comes to rest 1–2 ft
    // FROM THE CUP (green constant-decel model: dist = v²/(2·greenDecel)).
    // The ball already sits ~1 ft out at the far lip, so subtract that and
    // roll the remainder. Stays grounded so the distance is exact (no skying).
    const ftU = 1 / (YARDS_PER_UNIT * 3);           // 1 foot in world units
    const lipOut = HOLE.holeRadius + BALL_RADIUS_UNITS + 0.05;  // current dist past center
    const targetFromCup = (1 + rand()) * ftU;       // 1–2 ft final resting dist
    const roll = Math.max(0.15 * ftU, targetFromCup - lipOut);  // remaining roll
    const v = Math.sqrt(2 * TUNE.greenDecel * roll);
    b.vx = dx * v; b.vy = dy * v; b.vz = 0;
    return { lip: true, grounded: true };
  }
  // rammed too hard — skips the cup and keeps rolling, with a small hop.
  const excess = spd - TUNE.captureSpeed;
  b.vz = Math.min(0.07, excess * 1.5);
  return { lip: true, hop: b.vz > 0.004 };
}

// =====================================================================
//  Launch-time shot prediction — powers the cinematic 3D landing
// =====================================================================
// Replays the per-frame physics (arcFlightStep -> ballisticFlightStep -> rollStep)
// on a LOCAL ball with zero side effects (no sound/haptic/particles/state), to
// learn where a just-launched shot finishes. Deterministic: wind is fixed per
// hole, the green break field is analytic, and the one Math.random on the real
// path (the lip-out re-pace) is injected as a constant here — and a lip-out
// triggers the cinematic regardless of where it dies. The drift-prone math lives
// in the shared pure helpers (landingRelease, resolveCup); the motion code below
// MUST MATCH the real step functions.
// Returns { holed:true } | { x, y, surf, lipped } | null (never settled / dead ball).
function simShotRest(ball0, flight0) {
  const b = { x: ball0.x, y: ball0.y, vx: ball0.vx, vy: ball0.vy,
              z: ball0.z, vz: ball0.vz, spin: ball0.spin };
  let fl = Object.assign({}, flight0);
  let airborne = !!flight0, lipped = false; // matches update()'s real dispatch: putts start grounded (flight0=null)
  for (let i = 0; i < TUNE.cineSimSteps; i++) {
    if (airborne && fl) {
      // --- arc phase (mirrors arcFlightStep) ---
      fl.d += fl.vh;
      b.x += b.vx; b.y += b.vy;
      if (b.spin) {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const px = -b.vy / sp, py = b.vx / sp;
        const a = b.spin * TUNE.spinFactor * sp;
        b.vx += px * a; b.vy += py * a;
      }
      if (wind.speed > 0) {
        const we = TUNE.windEffect * (fl.windMul || 1);
        b.vx -= Math.sin(wind.dir) * wind.speed * we;
        b.vy += Math.cos(wind.dir) * wind.speed * we;
      }
      const t = fl.d <= fl.xa ? (fl.d - fl.xa) / fl.xa : (fl.d - fl.xa) / (fl.C - fl.xa);
      b.z = Math.max(fl.H * (1 - t * t), 0);
      clampToWorld(b);
      if (fl.d >= fl.C || (fl.d > fl.xa && b.z <= 0)) {
        b.z = 0;
        const surf = surfaceAt(b.x, b.y);
        const sp = Math.hypot(b.vx, b.vy) || 1, dx = b.vx / sp, dy = b.vy / sp;
        if (surf === "water" || surf === "woods" || surf === "ob") return null; // dead — no trigger
        const v = landingRelease(fl, b.spin, surf);
        b.vx = dx * v; b.vy = dy * v; b.vz = 0; b.spin = 0;
        fl = null; airborne = false;
      }
    } else if (airborne) {
      // --- ballistic bounces (mirrors ballisticFlightStep) ---
      b.x += b.vx; b.y += b.vy; b.z += b.vz;
      const impactVz = b.vz;
      b.vz -= TUNE.gravity;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 1e-4 && b.spin) {
        const px = -b.vy / sp, py = b.vx / sp;
        const a = b.spin * TUNE.spinFactor * sp;
        b.vx += px * a; b.vy += py * a;
      }
      b.vx *= TUNE.airDrag;
      b.vy *= TUNE.airDrag;
      if (wind.speed > 0) {
        b.vx -= Math.sin(wind.dir) * wind.speed * TUNE.windEffect;
        b.vy += Math.cos(wind.dir) * wind.speed * TUNE.windEffect;
      }
      clampToWorld(b);
      if (b.z <= 0) {
        b.z = 0;
        const surf = surfaceAt(b.x, b.y);
        const down = -impactVz;
        if (surf === "water" || surf === "woods" || surf === "ob") return null;
        if (down > TUNE.bounceStopVz) {
          const bo = TUNE.bounce[surf] || TUNE.bounce.fairway;
          b.vz = down * bo.e;
          b.vx *= bo.h; b.vy *= bo.h;
          b.spin *= 0.5;
        } else {
          b.vz = 0; b.spin = 0; airborne = false;
        }
      }
    } else {
      // --- roll phase (mirrors rollStep) ---
      b.x += b.vx; b.y += b.vy;
      clampToWorld(b);
      const surf = surfaceAt(b.x, b.y);
      if (surf === "green") {
        const sp = Math.hypot(b.vx, b.vy);
        const k = sp > 0 ? Math.max(0, sp - TUNE.greenDecel) / sp : 0;
        b.vx *= k; b.vy *= k;
        if (sp > TUNE.slopeStopSpeed) {
          const g = greenSlopeAt(b.x, b.y);
          if (g) {
            const gm = Math.hypot(g.x, g.y);
            const force = gm > 0 ? Math.min(TUNE.slopeAccel * gm, TUNE.greenDecel * TUNE.slopeCapFrac) / gm : 0;
            b.vx -= force * g.x; b.vy -= force * g.y;
          }
        }
      } else {
        const sp = Math.hypot(b.vx, b.vy);
        const f = TUNE.friction[surf];
        b.vx *= f; b.vy *= f;
        if (HOLE._dem && sp > TUNE.slopeStopSpeed) {
          const gv = HOLE._dem.gradAt(b.x, b.y);
          b.vx -= TUNE.fairwaySlopeAccel * gv.x;
          b.vy -= TUNE.fairwaySlopeAccel * gv.y;
        }
      }
      const speed = Math.hypot(b.vx, b.vy);
      if (!HOLE.isRange && !lipped) {
        const cup = resolveCup(b, speed, false, () => 0.5);
        if (cup) {
          if (cup.holed) return { holed: true };
          lipped = true;                       // like state._lippedThisShot — never re-test
          if (cup.hop) airborne = true;        // rammed lip-over keeps flying (grounded lip already re-paced)
        }
      }
      if (speed < TUNE.stopThreshold)
        return { x: b.x, y: b.y, surf: surfaceAt(b.x, b.y), lipped };
    }
  }
  return null;
}

// Arm the cinematic if the shot just launched deserves it: predicted holed, a
// lip-out, or resting on a green inside the distance-scaled bar. Must be the
// LAST thing the launch does — noLandCheck/windMul are set after setupFlight.
function maybeArmCine() {
  cinePending = null;
  if (!cineEnabled || mode !== "course" || !HOLE || HOLE.isRange) return;
  if (!state.airborne || !state.flight) return;   // putts/bump-and-runs never cut
  const g = (HOLE._greens || []).find((gr) => pointInPoly(HOLE.holePos.x, HOLE.holePos.y, gr.poly));
  if (!g) return;                                  // vector-fallback hole without a pin green
  const r = slottedMode ? { holed: true } : simShotRest(state.ball, state.flight);
  if (!r) return;
  let great = !!(r.holed || r.lipped);
  if (!great && r.surf === "green") {
    const shotYds = dist(state.ball.x, state.ball.y, r.x, r.y) * YARDS_PER_UNIT;
    const barFt = Math.max(TUNE.cineMinFt, Math.min(TUNE.cineMaxFt, shotYds * TUNE.cineFtPerYd));
    const restFt = dist(r.x, r.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT * 3;
    great = restFt <= barFt;
  }
  if (!great) return;
  const fl = state.flight;
  // Mesh baked NOW (ball at rest off-green → no baked ball marker, no mid-flight hitch);
  // the cut itself waits for the descent (tickCine).
  cinePending = {
    g, mesh: buildGreenViewMesh(g),
    openAtD: fl.xa + TUNE.cineCutFrac * (fl.C - fl.xa),
  };
}

// =====================================================================
//  Input — swipe swing (touch) with mouse fallback for desktop
// =====================================================================
let swipe = null;     // { x, y, t }
let swipePath = null; // sampled screen points of the in-progress swipe
let swingIsMouse = false; // true when the active swing came from mouse drag (not touch/trackpad)
// Fixed swipe->power scale (full-hole fit, set in resize). Using this instead of
// the live camera zoom keeps swing sensitivity identical at every stroke, so a
// full swing doesn't auto-scale to always reach the green.
let refScale = 1;
const canvas = document.getElementById("game");

function canSwing() {
  return (mode === "course" || mode === "range") && !state.moving && !state.inHole && !holeTransition
    && !greenView  // 3D green inspect open: swings/aiming suspended
    && !cine       // cinematic landing playing: input suspended until it closes
    && myTurn();   // live match: only the "away" / honors player may swing
}

// =====================================================================
//  Hole-out feedback — synthesized sound (Web Audio, no asset files),
//  light haptic, and the drop-into-cup animation timing.
// =====================================================================
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  if (audioCtx) loadSfxSamples();
  return audioCtx;
}
// Browsers gate audio until a user gesture — unlock the context on first interaction.
window.addEventListener("pointerdown", ensureAudio);
window.addEventListener("touchstart", ensureAudio, { passive: true });

// The sound a ball makes finding the cup: two quick rim ticks, then a hollow plunk.
function playHolePlunk() {
  const ac = ensureAudio();
  if (!ac) return;
  const t = ac.currentTime;
  const tick = (when, freq, vol) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "triangle"; o.frequency.value = freq;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, when + 0.05);
    o.connect(g).connect(ac.destination);
    o.start(when); o.stop(when + 0.08);
  };
  tick(t, 1500, 0.12);             // rim rattle
  tick(t + 0.055, 1180, 0.10);
  const o = ac.createOscillator(), g = ac.createGain();  // hollow cup plunk
  o.type = "sine";
  o.frequency.setValueAtTime(380, t + 0.06);
  o.frequency.exponentialRampToValueAtTime(150, t + 0.20);
  g.gain.setValueAtTime(0, t + 0.06);
  g.gain.linearRampToValueAtTime(0.34, t + 0.078);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
  o.connect(g).connect(ac.destination);
  o.start(t + 0.06); o.stop(t + 0.36);
}

// --- Mute (every synth SFX honours this). Persisted so it survives reloads. ---
let muted = (() => { try { return localStorage.getItem("golf.muted") === "1"; } catch (e) { return false; } })();
function setMuted(m) { muted = !!m; try { localStorage.setItem("golf.muted", m ? "1" : "0"); } catch (e) {} }

// Lazy white-noise buffer reused for "crack"/splash textures.
let _noiseBuf = null;
function noiseBuffer(ac) {
  if (_noiseBuf) return _noiseBuf;
  const n = Math.floor(ac.sampleRate * 0.25);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  _noiseBuf = buf; return buf;
}
// One decaying oscillator note (optionally pitch-sweeping to freqEnd).
function tone(ac, when, freq, dur, vol, type = "sine", freqEnd) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, when);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), when + dur);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0006, when + dur);
  o.connect(g).connect(ac.destination);
  o.start(when); o.stop(when + dur + 0.02);
}
// One filtered noise burst (the "texture" layer for impacts/splashes).
function noiseHit(ac, when, dur, vol, hp) {
  const src = ac.createBufferSource(); src.buffer = noiseBuffer(ac);
  const g = ac.createGain(), f = ac.createBiquadFilter();
  f.type = "highpass"; f.frequency.value = hp || 400;
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0006, when + dur);
  src.connect(f).connect(g).connect(ac.destination);
  src.start(when); src.stop(when + dur + 0.02);
}
// --- Real recorded swing/strike (sounds/*.wav — Pixabay Content License,
// commercial-OK, no attribution). Decoded lazily on the first user gesture;
// until then (or if the fetch/decode fails, e.g. an offline file:// run)
// playStrike falls back to the old synth crack.
const SFX_SAMPLES = { whoosh: "sounds/swing-whoosh.wav", strike: "sounds/strike.wav" };
const sfxBuf = {};
let _sfxLoadStarted = false;
function loadSfxSamples() {
  if (_sfxLoadStarted || !audioCtx) return;
  _sfxLoadStarted = true;
  for (const [key, url] of Object.entries(SFX_SAMPLES)) {
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((ab) => audioCtx.decodeAudioData(ab))
      .then((buf) => { sfxBuf[key] = buf; })
      .catch(() => {});
  }
}
function playSample(buf, when, vol, rate) {
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate || 1;
  const g = audioCtx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(audioCtx.destination);
  src.start(when);
}
// Strike off the clubface: real club whoosh swelling into the recorded contact
// crack, both scaled by swing power. Synth fallback until samples decode.
const STRIKE_VOL = 0.55;  // master volume on the swing whoosh + contact crack
function playStrike(power) {
  if (muted) return; const ac = ensureAudio(); if (!ac) return;
  const t = ac.currentTime, p = Math.max(0.2, Math.min(1, power || 0.6));
  if (sfxBuf.strike) {
    const jitter = 0.97 + Math.random() * 0.06;   // never the exact same hit twice
    if (sfxBuf.whoosh && p > 0.45) {
      const wRate = (0.9 + 0.35 * p) * jitter;    // faster swing = quicker, brighter whoosh
      playSample(sfxBuf.whoosh, t, (0.10 + 0.5 * p) * STRIKE_VOL, wRate);
      const impact = t + (sfxBuf.whoosh.duration / wRate) * 0.7; // crack rides the whoosh peak
      playSample(sfxBuf.strike, impact, (0.35 + 0.65 * p) * STRIKE_VOL, (0.94 + 0.12 * p) * jitter);
    } else {
      // soft swing / chip: contact only, duller and quieter
      playSample(sfxBuf.strike, t, (0.25 + 0.5 * p) * STRIKE_VOL, 0.9 * jitter);
    }
    return;
  }
  noiseHit(ac, t, 0.05, 0.22 * p * STRIKE_VOL, 1200 + 2600 * p);
  tone(ac, t, 220 + 120 * p, 0.06, 0.10 * p * STRIKE_VOL, "square", 90);
}
// Soft tap of a putt.
function playPutt() {
  if (muted) return; const ac = ensureAudio(); if (!ac) return;
  const t = ac.currentTime;
  tone(ac, t, 300, 0.05, 0.09, "sine", 160);
  noiseHit(ac, t, 0.03, 0.05, 800);
}
// Landing — soft thud on turf, deeper splash in water. `speed` = downward pace.
function playLand(surface, speed) {
  if (muted) return; const ac = ensureAudio(); if (!ac) return;
  const t = ac.currentTime, v = Math.max(0.15, Math.min(1, (speed || 0.05) * 12));
  if (surface === "water" || surface === "woods") {
    noiseHit(ac, t, 0.22, 0.16 * v, 300);
    tone(ac, t, 180, 0.18, 0.09, "sine", 80);
  } else {
    noiseHit(ac, t, 0.06, 0.13 * v, 250);
    tone(ac, t, 110, 0.07, 0.10 * v, "sine", 70);
  }
}
// Penalty — low descending "dunk": the ball is gone, stroke added.
function playPenalty() {
  if (muted) return; const ac = ensureAudio(); if (!ac) return;
  const t = ac.currentTime;
  tone(ac, t, 220, 0.28, 0.12, "sine", 95);
  noiseHit(ac, t + 0.05, 0.14, 0.08, 220);
}
// "Aww" — a putt rims the cup and stays out. Near-miss = motivating sting.
function playNearMiss() {
  if (muted) return; const ac = ensureAudio(); if (!ac) return;
  const t = ac.currentTime;
  tone(ac, t, 520, 0.10, 0.10, "triangle");          // rim tick
  tone(ac, t + 0.04, 660, 0.34, 0.11, "sine", 300);  // descending sigh
}
// Celebration arpeggio — longer + higher the better the hole (0 par … 4 ace).
function playCelebrate(level) {
  if (muted) return; const ac = ensureAudio(); if (!ac) return;
  const t = ac.currentTime;
  const scales = [
    [392],                          // 0: par
    [523, 659],                     // 1: birdie
    [523, 659, 784],                // 2: eagle
    [523, 659, 784, 1047],          // 3: albatross
    [523, 659, 784, 1047, 1319],    // 4: ace
  ];
  const notes = scales[Math.max(0, Math.min(4, level))];
  notes.forEach((f, i) => tone(ac, t + i * 0.085, f, 0.28, 0.15, "triangle"));
}

// Light haptic. Native app (Capacitor) gets the real haptic engine via the
// Haptics plugin. On the web, navigator.vibrate is Android-only (iOS Safari has
// NO web vibration API), so we also toggle a hidden <input switch> — the one
// trick that emits a system haptic tick on iOS 17.4+. Best-effort everywhere.
const hapticSwitch = document.querySelector("#haptic-switch input");
function capHaptics() {
  const C = window.Capacitor;   // injected by the native shell, absent on web
  return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins) ? C.Plugins.Haptics : null;
}
function haptic(pattern) {
  const H = capHaptics();
  if (H) {
    try {
      // Arrays are celebration patterns (hole-out) -> success notification;
      // single numbers map by intensity to impact strength.
      if (Array.isArray(pattern)) H.notification({ type: "SUCCESS" });
      else H.impact({ style: pattern <= 4 ? "LIGHT" : pattern <= 12 ? "MEDIUM" : "HEAVY" });
    } catch (e) { /* ignore */ }
    return;
  }
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  if (hapticSwitch) { try { hapticSwitch.checked = !hapticSwitch.checked; } catch (e) { /* ignore */ } }
}
function beginHoleDrop(x, y, vx, vy) {
  holeDrop = { t0: performance.now(), x, y, vx, vy };
  playHolePlunk();
  haptic([14, 22, 40]);   // tick · gap · firmer thud — the ball settling into the cup
}
// Open the result modal once the drop animation has played out.
function tickHoleDrop() {
  if (holeDrop && performance.now() - holeDrop.t0 >= HOLE_DROP_MS) {
    holeDrop = null;
    showResult();
  }
}

// Signed curvature of a swipe path in [-1, 1] (0 = straight). Compares the
// first half of the gesture to the second half; a bend imparts draw/fade spin.
function curveFromPath(pts) {
  if (!pts || pts.length < 3) return 0;
  const a = pts[0], m = pts[pts.length >> 1], b = pts[pts.length - 1];
  const v1x = m.x - a.x, v1y = m.y - a.y;
  const v2x = b.x - m.x, v2y = b.y - m.y;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-3 || m2 < 1e-3) return 0;
  return (v1x * v2y - v1y * v2x) / (m1 * m2); // sign of cross product
}

// Release velocity over the last `lookMs` of a timestamped path, denoised so one
// jittery sample (common on trackpads/mice) can't dictate the shot. We drop the
// single worst per-step outlier, then least-squares fit x(t) and y(t) — the slope
// is the velocity, the span × slope is the displacement vector returned.
// Returns { dxs, dys, dt } in path units; dt is the fitted window length (s).
function swipeVelocity(path, lookMs) {
  const end = path[path.length - 1];
  let si = path.length - 1;
  while (si > 0 && end.t - path[si - 1].t < lookMs) si--;
  const win = path.slice(si);
  // Too few points to fit — fall back to the raw 2-point delta.
  if (win.length < 3) {
    const ref = path[si > 0 ? si - 1 : 0];
    return { dxs: end.x - ref.x, dys: end.y - ref.y,
             dt: Math.max((end.t - ref.t) / 1000, 0.001) };
  }
  // Per-step speeds; drop the one step that deviates most from the median speed.
  const steps = [];
  for (let i = 1; i < win.length; i++) {
    const dt = (win[i].t - win[i - 1].t) / 1000 || 1e-3;
    steps.push({ i, sp: Math.hypot(win[i].x - win[i - 1].x, win[i].y - win[i - 1].y) / dt });
  }
  const med = [...steps].sort((a, b) => a.sp - b.sp)[steps.length >> 1].sp;
  let worst = -1, wd = -1;
  for (const s of steps) { const d = Math.abs(s.sp - med); if (d > wd) { wd = d; worst = s.i; } }
  const pts = win.filter((_, k) => k !== worst);
  // Least-squares slope of x(t), y(t) over the cleaned window (t relative to first).
  const t0 = pts[0].t;
  let st = 0, stt = 0, sx = 0, sy = 0, stx = 0, sty = 0;
  const n = pts.length;
  for (const p of pts) {
    const t = (p.t - t0) / 1000;
    st += t; stt += t * t; sx += p.x; sy += p.y; stx += t * p.x; sty += t * p.y;
  }
  const denom = n * stt - st * st;
  const span = Math.max((pts[n - 1].t - t0) / 1000, 0.001);
  if (Math.abs(denom) < 1e-9) {            // degenerate (all same time) — raw delta
    return { dxs: pts[n - 1].x - pts[0].x, dys: pts[n - 1].y - pts[0].y, dt: span };
  }
  const vx = (n * stx - st * sx) / denom;  // units / s
  const vy = (n * sty - st * sy) / denom;
  return { dxs: vx * span, dys: vy * span, dt: span };
}

// Pure: screen-space swipe velocity vector -> (ang, frac). Shared by the real
// release path (swingEnd/launch) and the live pre-release preview, so both
// derivations can never drift apart. `powerScale` differs by input method
// (TUNE.touchPowerSwipe vs TUNE.fullPowerSwipe) — that asymmetry is existing
// tuning, not something to unify here.
function swipeToShot(dxs, dys, dt, powerScale) {
  const speed = (Math.hypot(dxs, dys) / refScale) / Math.max(dt, 0.001);
  const frac = Math.min(speed * swingSens / powerScale, 1);
  let ang;
  if (view.appleProj) {
    // Apple-ground 3D: the affine inverse doesn't hold under the pitched
    // pinhole. Unproject the swipe as a short screen segment through the
    // ball's screen position onto the ground plane — the world direction the
    // finger actually traced across the terrain.
    const b = state.ball;
    const s0 = appleProjPt(view.appleProj, b.x, b.y);
    const p0 = appleUnproject(view.appleProj, s0.x, s0.y);
    const p1 = appleUnproject(view.appleProj, s0.x + dxs, s0.y + dys);
    ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  } else {
    ang = Math.atan2(dys / view.tilt, dxs) - view.angle; // undo tilt squash, then rotation
  }
  return { ang, frac };
}

// Putt power fraction with a widened control band: the first puttControlFrac of
// input covers 0..puttControlYds (gentle, easy to lag), the top covers the rest
// up to YARDS.maxPutt. Returns a 0..1 multiplier on puttMaxPower.
function puttPowerFrac(f) {
  const cf = TUNE.puttControlFrac;
  // Putt distance ∝ power², so the power share at the knee is sqrt(distance ratio).
  const cFrac = Math.min(1, Math.sqrt(TUNE.puttControlYds / YARDS.maxPutt));
  if (f <= cf) return cFrac * Math.sqrt(f / cf);          // wide low-sensitivity segment
  return cFrac + (1 - cFrac) * ((f - cf) / (1 - cf));     // steep top segment up to max
}

// `id` (a touch identifier) pins the position to the SAME finger for the whole
// gesture. Without it, a stray second contact (palm/thumb while holding the
// phone one-handed) can reorder `touches[0]` mid-drag and yank the rangefinder
// marker (or swipe) away from the finger that's actually doing the dragging.
function pointerPos(e, id) {
  const rect = canvas.getBoundingClientRect();
  const src = (id != null && (camTouchOf(e.touches, id) || camTouchOf(e.changedTouches, id)))
            || (e.touches && e.touches[0])
            || (e.changedTouches && e.changedTouches[0])
            || e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

// Two-finger camera state: { id0, id1, cx, cy, dist, angle, camAngle, camScale, focusX, focusY }
let camTouch = null;
function camTouchOf(touches, id) {
  if (!touches) return null;
  for (let i = 0; i < touches.length; i++) if (touches[i].identifier === id) return touches[i];
  return null;
}
// Touch identifier the current single-finger gesture (swipe / measure-drag /
// marker-drag) is pinned to. Null while using mouse input.
let activeTouchId = null;

// Mobile browsers replay a tap as synthetic mouse events (mousedown/mouseup)
// after touchend. Those land on the just-dropped rangefinder marker, register
// as a "tap on the marker" and dismiss it instantly. Ignore mouse input for a
// beat after any touch.
let lastTouchT = 0;
function ghostMouse(e) {
  if (e.type.indexOf("touch") === 0) { lastTouchT = performance.now(); return false; }
  return e.type.indexOf("mouse") === 0 && performance.now() - lastTouchT < 800;
}

function swingStart(e) {
  if (ghostMouse(e)) return;
  if (cine) { closeCine(); return; }              // cinematic landing: tap = skip
  if (greenView) { gvPointerStart(e); return; }   // inspect view owns the pointer
  shotPreview = null; // fresh gesture — any stale preview marker must not survive into it
  // Pin this gesture to whichever touch just landed (undefined for mouse —
  // pointerPos falls back to touches[0]/the event itself in that case).
  activeTouchId = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].identifier : null;
  if (measureMode) { const p = pointerPos(e, activeTouchId); measurePoint = screenToWorldGround(p.x, p.y); measureDragging = true; return; }
  if (e.touches && e.touches.length >= 2) {
    // second finger landed — cancel any pending swing, enter camera-manipulation mode
    swipe = null; swipePath = null;
    const t0 = e.touches[0], t1 = e.touches[1];
    const dx = t1.clientX - t0.clientX, dy = t1.clientY - t0.clientY;
    camTouch = {
      id0: t0.identifier, id1: t1.identifier,
      cx: (t0.clientX + t1.clientX) / 2, cy: (t0.clientY + t1.clientY) / 2,
      dist: Math.hypot(dx, dy), angle: Math.atan2(dy, dx),
      camAngle: camera.angle, camScale: camera.scale,
      focusX: camera.focus.x, focusY: camera.focus.y,
    };
    if (earnMilestone("hint-camera")) showToast("Twist to aim · pinch to zoom", 2200, "gold");
    return;
  }
  // grab the dropped rangefinder marker if the press lands on it (drag to move,
  // tap to dismiss). Grace period after the drop: any re-entrant event replaying
  // the tap (synthetic mouse, duplicate touch) must not instantly dismiss it.
  if (measurePoint && performance.now() - markerDropT > 600) {
    const p = pointerPos(e, activeTouchId);
    const mx = wx(measurePoint.x, measurePoint.y), my = wyg(measurePoint.x, measurePoint.y);
    if (Math.hypot(p.x - mx, p.y - my) <= MARKER_HIT_PX) {
      markerDrag = { moved: false, x: p.x, y: p.y };
      swipe = null; swipePath = null;
      return;
    }
  }
  if (!canSwing()) return;
  camTouch = null;
  swingIsMouse = !!(e && typeof e.type === "string" && e.type.indexOf("mouse") === 0);
  const p = pointerPos(e, activeTouchId);
  const now = performance.now();
  swipe = { x: p.x, y: p.y, t: now };
  swipePath = [{ x: p.x, y: p.y, t: now }];
}
function swingMove(e) {
  if (ghostMouse(e)) return;
  if (cine) { e.preventDefault(); return; }
  if (greenView) { e.preventDefault(); gvPointerMove(e); return; }
  if (measureMode) { if (measureDragging) { e.preventDefault(); const p = pointerPos(e, activeTouchId); measurePoint = screenToWorldGround(p.x, p.y); } return; }
  if (camTouch && e.touches && e.touches.length >= 2) {
    // two-finger camera: pinch (zoom), drag (pan), twist (rotate)
    e.preventDefault();
    const t0 = camTouchOf(e.touches, camTouch.id0);
    const t1 = camTouchOf(e.touches, camTouch.id1);
    if (!t0 || !t1) return;
    const dx = t1.clientX - t0.clientX, dy = t1.clientY - t0.clientY;
    const cx = (t0.clientX + t1.clientX) / 2, cy = (t0.clientY + t1.clientY) / 2;
    const newDist = Math.hypot(dx, dy), newAng = Math.atan2(dy, dx);

    // zoom: clamp to 0.25× – 4× the original hole-fit scale
    const minScale = camTouch.camScale * 0.25, maxScale = camTouch.camScale * 4;
    camera.tScale = Math.max(minScale, Math.min(maxScale, camTouch.camScale * newDist / camTouch.dist));
    camera.scale = camera.tScale;

    // rotate: world follows the fingers (twist CW = map turns CW, like a map app).
    // Screen y points down, so a visually-CW twist raises atan2, and +camera.angle
    // also turns the world CW on screen — same sign, so ADD the twist.
    const dAng = angDiff(newAng, camTouch.angle);
    camera.tAngle = camTouch.camAngle + dAng;
    camera.angle = camera.tAngle;

    // pan: midpoint shift in world coords. Under the Apple 3D pinhole the
    // flat affine is wrong (pan speed/direction bend with pitch) — move by
    // the world delta between the previous and current midpoint UNPROJECTED
    // onto the terrain, incrementally per event: the ground point under the
    // fingers stays under the fingers, exactly like panning Apple Maps.
    if (view.appleProj) {
      const pcx = camTouch.prevCx != null ? camTouch.prevCx : camTouch.cx;
      const pcy = camTouch.prevCy != null ? camTouch.prevCy : camTouch.cy;
      const w0 = appleUnproject(view.appleProj, pcx, pcy);
      const w1 = appleUnproject(view.appleProj, cx, cy);
      camera.tFocus.x += w0.x - w1.x;
      camera.tFocus.y += w0.y - w1.y;
      camTouch.prevCx = cx; camTouch.prevCy = cy;
    } else {
      const dcx = cx - camTouch.cx, dcy = cy - camTouch.cy;
      const cos = Math.cos(camera.angle), sin = Math.sin(camera.angle);
      camera.tFocus.x = camTouch.focusX - (dcx * cos + dcy * sin) / camera.scale;
      camera.tFocus.y = camTouch.focusY - (-dcx * sin + dcy * cos) / camera.scale;
    }
    camera.focus.x = camera.tFocus.x;
    camera.focus.y = camera.tFocus.y;
    return;
  }
  if (markerDrag) {
    e.preventDefault();
    const p = pointerPos(e, activeTouchId);
    if (Math.hypot(p.x - markerDrag.x, p.y - markerDrag.y) > 4) markerDrag.moved = true;
    measurePoint = screenToWorldGround(p.x, p.y);
    return;
  }
  if (!swipe) return;
  e.preventDefault();
  const p = pointerPos(e, activeTouchId);
  swipePath.push({ x: p.x, y: p.y, t: performance.now() });
  maybeUpdateShotPreview();
}

// Fire the ball: `ang` direction, `frac` 0..1 swing fullness, `spin` (-1..1).
function slottedLaunch() {
  const b = state.ball;
  shot.startX = b.x; shot.startY = b.y;
  shot.carry = null; shot.total = null; shot.carried = false;
  state.flight = null;
  const ang = Math.atan2(HOLE.holePos.y - b.y, HOLE.holePos.x - b.x);
  const C = dist(b.x, b.y, HOLE.holePos.x, HOLE.holePos.y);
  const H = Math.max(C * 0.12, 0.3); // low clean arc toward hole
  setupFlight(b, ang, C, H, Math.PI / 4, 0);
  b.spin = 0;
  state.airborne = true;
  state.moving = true;
  haptic(9);
  state.strokesOffGreen++;
  state.strokes += 1;
  updateScorecard();
  if (matchLive()) pushMatchShot({ cur_at_rest: false });  // opponent sees "hitting…"
  hideHint();
  maybeArmCine();  // predict the finish; a great one cues the 3D landing cut
}

// Greenside chip gate: chip mode on, off the green, within range of the pin. Shared
// by launchShot (physics), updateClubUI (carry readout) and the spin slider show/hide
// so they never disagree about when a chip is in play.
function chipActiveNow() {
  if (!chipEnabled || !HOLE || HOLE.isRange) return false;
  const b = state.ball;
  if (surfaceAt(b.x, b.y) === "green") return false;
  return dist(b.x, b.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT < TUNE.chipRangeYds;
}
// Chip spin slider -> { landFrac, spinScale } (bias -1..+1). More spin lands the ball
// deeper (higher landFrac) and checks harder (higher spinScale); less spin lands short
// and runs. Neutral (0) reproduces TUNE.chipLandFrac / TUNE.chipSpin exactly.
function chipSpinParams() {
  const bias = chipSpinBias;
  const landFrac = Math.max(0.5, Math.min(0.98, TUNE.chipLandFrac + bias * TUNE.chipLandSpread));
  const spinScale = TUNE.chipSpin * Math.pow(TUNE.chipSpinRange, bias);
  return { landFrac, spinScale };
}

// Pure: given a swing vector, compute what the shot WOULD do — club/putter
// selection, carry/height/spin, initial ball velocity, and (for full shots) a
// flight descriptor — WITHOUT mutating state.ball/state.flight/shot/etc. Used
// by launchShot (real, committed shot — applies the result to state) and by
// the live pre-release preview (hypothetical, fed into simShotRest and
// discarded). Returns null if the swing wouldn't produce a shot at all.
function buildTrialShot(ang, frac, spin, onGreen) {
  if (frac <= 0.05) return null;
  if (slottedMode && !HOLE.isRange && !onGreen) return null; // slotted mode has its own fixed-target launch — no meaningful preview
  const b = state.ball; // read position only
  const f = Math.min(frac, 1);
  // Putter mode: on the green (normal putt) OR player manually selected putter off-green
  // (bump-and-run). Both stay on the deck; power scale differs to account for surface friction.
  const usePutter = onGreen || selectedClub === "putter";
  if (usePutter) {
    let power;
    if (onGreen && !HOLE.isRange) {
      // Pace forgiveness: map swipe across a band that always leaves the ball between
      // 20% short and 20% long of the cup. f=0.5 = dead pace. Plays-like distance folds
      // in uphill/downhill so the band holds on sloped greens.
      const flatU = dist(b.x, b.y, HOLE.holePos.x, HOLE.holePos.y);
      const band = TUNE.puttBandLo + (TUNE.puttBandHi - TUNE.puttBandLo) * f;
      const targetU = Math.min(flatU * band, YARDS.maxPutt / YARDS_PER_UNIT);  // world units
      // Climb cost in the SAME field/units the roll's slope force uses → dead pace reaches
      // the cup uphill and down (slope force opposes uphill, aids downhill — budget for it).
      const hB = greenHeightAt(b.x, b.y), hP = greenHeightAt(HOLE.holePos.x, HOLE.holePos.y);
      const rise = (hB == null || hP == null) ? 0 : (hP - hB);       // + uphill, − downhill
      let v2;
      if (rise < 0) {
        // Downhill: invert the ACTUAL roll model instead of an energy budget. The
        // roll's downhill aid is capped at greenDecel·slopeCapFrac (net decel is
        // always positive — the ball can never run away) and gated off entirely
        // below slopeStopSpeed. A raw work budget (2·slopeAccel·rise) credits
        // gravity the roll never delivers, collapses v2 toward 0, and every
        // downhill putt launched at the old floor speed and died ~half way — the
        // cup was unreachable at ANY swing power. Piecewise instead: net decel
        // a1 = greenDecel − aid while above the gate, full greenDecel below it.
        const gmAvg = -rise / Math.max(flatU, 1e-6);   // avg downhill gradient along the line
        const aid = Math.min(TUNE.slopeAccel * gmAvg, TUNE.greenDecel * TUNE.slopeCapFrac);
        const a1 = TUNE.greenDecel - aid;
        const vg = TUNE.slopeStopSpeed;
        const dGate = vg * vg / (2 * TUNE.greenDecel); // dist the gated (unaided) tail covers
        v2 = targetU <= dGate ? 2 * TUNE.greenDecel * targetU
                              : vg * vg + 2 * a1 * (targetU - dGate);
      } else {
        // Flat/uphill: energy budget, slope cost capped to what the roll's clamped
        // force can actually apply over targetU (keeps v2 > 0 on steep climbs).
        const slopeWork = 2 * TUNE.slopeAccel * rise;
        const slopeCap = 2 * TUNE.greenDecel * TUNE.slopeCapFrac * targetU;
        v2 = 2 * TUNE.greenDecel * targetU + Math.min(slopeCap, slopeWork);
      }
      power = Math.sqrt(Math.max(v2, 1e-9));
      // Short-putt floor: inside puttFloorFt never leave it short. Use at least the pace to
      // reach the cup on flat.
      if (flatU * YARDS_PER_UNIT * 3 <= TUNE.puttFloorFt) {
        power = Math.max(power, Math.sqrt(2 * TUNE.greenDecel * flatU));
      }
    } else {
      // off-green bump-and-run (or range): calibrated to fairway friction (~30 yards max);
      // simple sqrt ramp (its max is already tiny). Range putts keep the on-green ramp.
      const maxPow = onGreen ? TUNE.puttMaxPower : TUNE.puttOffGreenPower;
      const ramp = onGreen ? puttPowerFrac(f) : Math.sqrt(f);
      const lieMul = (onGreen || !lieEffectEnabled) ? 1 : (TUNE.lie[surfaceAt(b.x, b.y)] ?? 1);  // bump from rough/sand loses pace
      power = maxPow * TUNE.puttSensitivity * ramp * lieMul;
    }
    const mph = Math.round(power * YARDS_PER_UNIT * 60 * (3600 / 1760)); // units/frame -> mph
    return { usePutter: true, onGreen, f, mph,
             vx: Math.cos(ang) * power, vy: Math.sin(ang) * power, z: 0, vz: 0, spin: 0, flight: null };
  }
  // full shot: follow the selected club's real arc, scaled by how full the swing is
  const c = TUNE.clubs[selectedClub];
  // Greenside chip mode: when enabled and within range of the pin, map swing power to a
  // tight band around the pin — softest swipe flies chipReachLo×pin, hardest chipReachHi×pin
  // (capped at club carry), so a chip is never very short or very far from the hole. Outside
  // chip mode every club flies its rated carry at full swing, floored at clubMinFrac. The
  // club still sets the arc/spin, so a LW pops-and-checks, a 9i runs.
  const chipActive = chipActiveNow();  // chip mode on, off green, within pin range
  let ef;
  if (chipActive) {
    // Tight band: f=0 -> chipReachLo, f=1 -> chipReachHi of pin distance. chipLandFrac
    // lands the CARRY short of that so the ball releases and rolls out the rest (the spin
    // drop below makes it run), with the total still finishing in the band. Reach uses
    // plays-like distance so an uphill chip flies/rolls longer (downhill shorter).
    const toPin = playsLikeYards(b.x, b.y).plays;
    const reach = TUNE.chipReachLo + (TUNE.chipReachHi - TUNE.chipReachLo) * f;
    ef = Math.min(1, (toPin * reach * chipSpinParams().landFrac) / c.carry);
  } else {
    // Min power floor for every full-swing club (incl. LW): an imprecise weak read can't
    // dribble it — always flies ≥ clubMinFrac of its rated carry.
    ef = Math.max(f, TUNE.clubMinFrac);
  }
  // Lie penalty: rough/sand grab the club -> less carry, lower flight, less ball speed.
  const lieSurf = surfaceAt(b.x, b.y);
  const lieMul = lieEffectEnabled ? (TUNE.lie[lieSurf] ?? 1) : 1;
  // Flight slider (right gutter, full shots): 0 = stock, 1 = full high spinner.
  // Continuous — each flightHi* knob is the t=1 endpoint, lerped by the slider.
  const hiT = chipActive ? 0 : flightBias;
  let C = (c.carry / YARDS_PER_UNIT) * ef * lieMul * (1 - (1 - TUNE.flightHiCarry) * hiT); // carry (world units)
  // Elevation: make a full shot finish at the plays-like distance (uphill shorter,
  // downhill longer). Chips already fold plays-like into their reach, so skip them.
  if (!chipActive) C = elevAdjustCarry(b.x, b.y, ang, C);
  const H = (c.maxH / YARDS_PER_UNIT) * ef * lieMul * (1 + (TUNE.flightHiApex - 1) * hiT); // apex height (scales with the swing)
  const mph = Math.round(c.ball * ef * lieMul);           // real ball speed for the HUD
  // Slight amplification so deliberate hooks/slices still register.
  const spinVal = Math.sign(spin) * Math.pow(Math.abs(spin), 0.9);
  // Full-shot pitches: partial swings with lofted clubs still impart near-full spin rpm
  // (scale up as f drops below 0.6, short shots check hard). Greenside CHIPS do the
  // opposite — drop spin so the ball lands short and rolls out to the pin (bump-and-run).
  const chipBoost = f < 0.6 ? 1 + (1 - f / 0.6) * 0.5 : 1;
  const lieSpinMul = lieEffectEnabled ? (TUNE.lieSpin[lieSurf] ?? 1) : 1;  // rough flyer / sand kill backspin
  const spinScale = chipActive ? chipSpinParams().spinScale : chipBoost;
  const effectiveSpinN = Math.min(1, c.spinN * spinScale * lieSpinMul * (1 + (TUNE.flightHiSpin - 1) * hiT));
  // Flyer descent: rough/sand shots also come in shallower (less lift), so the
  // steepness half of the landing check fades too and the ball releases. Chips skip it.
  const lieLandMul = (lieEffectEnabled && !chipActive) ? (TUNE.lieLand[lieSurf] ?? 1) : 1;
  const landDeg = c.land * lieLandMul + TUNE.flightHiLand * hiT;
  const flr = buildFlight(ang, C, H, landDeg * Math.PI / 180, effectiveSpinN);
  flr.flight.noLandCheck = chipActive; // chips: release tuned by the spin slider alone
  if (hiT > 0) flr.flight.windMul = 1 + (TUNE.flightHiWind - 1) * hiT; // a high ball rides the wind
  return { usePutter: false, onGreen, f, hiT, mph,
           vx: flr.vx, vy: flr.vy, z: flr.z, vz: flr.vz, spin: spinVal, flight: flr.flight };
}

function launchShot(ang, frac, spin, onGreen) {
  if (!canSwing() || frac <= 0.05) return;
  measurePoint = null; // shot fired — clear the rangefinder marker
  shotPreview = null;  // shot fired — clear the live preview marker
  if (slottedMode && !HOLE.isRange && !onGreen) { slottedLaunch(); return; }
  const trial = buildTrialShot(ang, frac, spin, onGreen);
  if (!trial) return;
  const b = state.ball;
  shot.startX = b.x; shot.startY = b.y;
  shot.carry = null; shot.total = null; shot.carried = onGreen; shot._landed = false;
  state._lippedThisShot = false;
  state.flight = trial.flight;
  b.vx = trial.vx; b.vy = trial.vy; b.vz = trial.vz; b.z = trial.z; b.spin = trial.spin;
  shot.mph = trial.mph;
  state.airborne = !trial.usePutter;
  if (trial.hiT > 0) resetFlightBias(); // one-shot: the slider never silently carries to the next swing
  state.moving = true;
  haptic(trial.usePutter ? 3 : 9);  // light tick for putter, firm buzz for full shot
  if (trial.usePutter) playPutt(); else playStrike(trial.f);  // crack/tap on contact
  if (onGreen) {
    state.putts++;
  } else {
    if (state.strokes === 0 && HOLE.par > 3) state._teeShot = true; // flag tee shot for FIR
    state.strokesOffGreen++;
  }
  state.strokes += 1;
  updateScorecard();
  if (matchLive()) pushMatchShot({ cur_at_rest: false });  // opponent sees "hitting…"
  hideHint();
  maybeArmCine();  // predict the finish; a great one cues the 3D landing cut
}

// Launch from a single screen-space swipe vector (dxs, dys) over dt seconds —
// trackpad path: no backswing, so swipe speed maps straight to power.
function launch(dxs, dys, dt, spin = 0) {
  if (!canSwing()) return;
  swingIsMouse = false;   // trackpad/wheel path — not a mouse drag
  const onGreen = surfaceAt(state.ball.x, state.ball.y) === "green";
  const { ang, frac } = swipeToShot(dxs, dys, dt, TUNE.fullPowerSwipe); // full swing at fullPowerSwipe
  launchShot(ang, frac, spin, onGreen);
}

function swingEnd(e) {
  if (ghostMouse(e)) return;
  if (cine) return;              // skip already handled on the press
  if (greenView) { gvPointerEnd(e); return; }
  if (measureMode) { measureDragging = false; return; }
  if (markerDrag) {
    // released on the marker without moving it => a click on the target => dismiss
    if (!markerDrag.moved) measurePoint = null;
    markerDrag = null;
    return;
  }
  if (camTouch) {
    if (!e.touches || e.touches.length < 2) camTouch = null;
    swipe = null; swipePath = null;
    return;
  }
  if (!swipe || !canSwing()) { swipe = null; swipePath = null; return; }
  const p = pointerPos(e, activeTouchId);
  swipePath.push({ x: p.x, y: p.y, t: performance.now() });
  const path = swipePath;
  swipe = null; swipePath = null;

  // Power = release velocity: look at the last ~80 ms of the path (finger speed at lift-off).
  // This makes "flick hard = far, flick soft = short" regardless of backswing size.
  const end = path[path.length - 1];
  const LOOK_MS = 80;
  const { dxs, dys, dt } = swipeVelocity(path, LOOK_MS);
  const fdist = Math.hypot(dxs, dys);
  if (fdist < 5) {
    // not a swing — treat as a tap: drop the rangefinder marker at the tap point
    shotPreview = null;
    measurePoint = screenToWorldGround(end.x, end.y);
    markerDropT = performance.now();
    if (earnMilestone("hint-marker"))
      showToast("Drag to move · tap to dismiss · press a green for front/mid/back", 2600, "gold");
    return;
  }

  const { ang, frac } = swipeToShot(dxs, dys, dt, TUNE.touchPowerSwipe);
  const onGreen = surfaceAt(state.ball.x, state.ball.y) === "green";
  launchShot(ang, frac, curveFromPath(path), onGreen);
}

canvas.addEventListener("touchstart", swingStart, { passive: true }); // never calls preventDefault — passive avoids blocking on it
canvas.addEventListener("touchmove", swingMove, { passive: false });
canvas.addEventListener("touchend", swingEnd);
// system gesture stole the touch (notification pull, app switch): drop all
// in-flight input state so the next tap starts clean
canvas.addEventListener("touchcancel", () => {
  swipe = null; swipePath = null; camTouch = null; markerDrag = null; measureDragging = false;
  activeTouchId = null; shotPreview = null;
  if (greenView) greenView.drag = null;
});
canvas.addEventListener("mousedown", swingStart);
canvas.addEventListener("mousemove", swingMove);
window.addEventListener("mouseup", swingEnd);

// --- Two-finger trackpad swipe (desktop) ---
// A two-finger swipe arrives as a stream of wheel events. We collect them for a
// short window from the first event, then launch in the swipe's direction. The
// shot goes opposite the scroll delta (swipe up = scroll-down delta = shoot up),
// matching natural scrolling; flip TUNE.wheelInvert for classic scrolling.
let wheelGesture = null;       // { sx, sy, t0 }
const WHEEL_WINDOW_MS = 140;   // collection window before the shot fires
const WHEEL_TAIL_MS = 220;     // swallow inertial momentum events within this gap
let wheelCooldownUntil = 0;    // ignore wheel events until this time (momentum tail)

function onWheel(e) {
  e.preventDefault();
  if (cine) return;  // cinematic: a trackpad swipe must not queue a phantom swing
  if (greenView) {   // desktop: scroll tilts the inspect view
    greenView.tilt = gvClamp(greenView.tilt + e.deltaY * 0.002, TUNE.gvTiltMin, TUNE.gvTiltMax);
    return;
  }
  const now = performance.now();
  // A trackpad swipe keeps emitting inertial "momentum" wheel events after the
  // fingers lift. Without this, those would start a NEW gesture and fire phantom
  // "aftershock" shots (worst on short putts that stop before the tail dies).
  // Each tail event pushes the cooldown out, so the whole tail is swallowed.
  if (now < wheelCooldownUntil) { wheelCooldownUntil = now + WHEEL_TAIL_MS; return; }
  if (!canSwing()) return;
  if (!wheelGesture) {
    wheelGesture = { sx: 0, sy: 0, t0: now, path: [{ x: 0, y: 0, t: now }] };
    setTimeout(finishWheelSwing, WHEEL_WINDOW_MS);
    if (earnMilestone("hint-keys")) showToast("← → aim · ↑ ↓ club", 2400, "gold");
  }
  wheelGesture.sx += e.deltaX;
  wheelGesture.sy += e.deltaY;
  wheelGesture.path.push({ x: wheelGesture.sx, y: wheelGesture.sy, t: now });
  maybeUpdateShotPreview();
}

function finishWheelSwing() {
  const g = wheelGesture;
  wheelGesture = null;
  if (!g) return;
  const sign = (TUNE.wheelInvert ? 1 : -1) * TUNE.wheelSensitivity;
  // Denoise the wheel stream the same way as touch — drop the worst delta spike and
  // fit the velocity — so one stray inertial event can't dictate power.
  const v = swipeVelocity(g.path, WHEEL_WINDOW_MS + WHEEL_TAIL_MS);
  // curve sign is invariant to negating the path, so it matches the finger swoosh
  launch(sign * v.dxs, sign * v.dys, v.dt, curveFromPath(g.path));
  wheelCooldownUntil = performance.now() + WHEEL_TAIL_MS; // start swallowing the tail
}

canvas.addEventListener("wheel", onWheel, { passive: false });

// =====================================================================
//  Live shot preview — while the player is still dragging/swiping (before
//  release), forward-simulate the swing-in-progress with simShotRest() and
//  show a marker + yardage at the predicted landing/rest spot. Opt-in
//  (shotPreviewEnabled, HUD menu "Shot preview") — a pure feedback overlay,
//  same physics as the real shot, no change to how power/spin/club work.
// =====================================================================
let shotPreview = null;   // { holed, lipped, rest:{x,y}, yards } | null
let lastPreviewT = 0;
const PREVIEW_INTERVAL_MS = 50; // ~20Hz — well under raw pointermove/wheel event rate

// Throttled entry point, called from swingMove/onWheel after each new sample.
function maybeUpdateShotPreview() {
  if (!shotPreviewEnabled) { shotPreview = null; return; }
  const now = performance.now();
  if (now - lastPreviewT < PREVIEW_INTERVAL_MS) return;
  lastPreviewT = now;
  updateShotPreview();
}

function updateShotPreview() {
  if (!canSwing() || measureMode) { shotPreview = null; return; }
  let ang, frac, spin;
  if (swipePath && swipePath.length >= 2) {
    const p0 = swipePath[0], pl = swipePath[swipePath.length - 1];
    if (Math.hypot(pl.x - p0.x, pl.y - p0.y) <= 12) { shotPreview = null; return; } // same gate as the direction tick
    const v = swipeVelocity(swipePath, 80);
    ({ ang, frac } = swipeToShot(v.dxs, v.dys, v.dt, TUNE.touchPowerSwipe));
    spin = curveFromPath(swipePath);
  } else if (wheelGesture && wheelGesture.path.length >= 3) {
    const sign = (TUNE.wheelInvert ? 1 : -1) * TUNE.wheelSensitivity;
    const v = swipeVelocity(wheelGesture.path, WHEEL_WINDOW_MS + WHEEL_TAIL_MS);
    ({ ang, frac } = swipeToShot(sign * v.dxs, sign * v.dys, v.dt, TUNE.fullPowerSwipe));
    spin = curveFromPath(wheelGesture.path);
  } else {
    shotPreview = null;
    return;
  }
  const onGreen = surfaceAt(state.ball.x, state.ball.y) === "green";
  const trial = buildTrialShot(ang, frac, spin, onGreen);
  if (!trial) { shotPreview = null; return; }
  // Hypothetical ball state fed into the side-effect-free simulator — never touches state.ball.
  const b0 = { x: state.ball.x, y: state.ball.y, vx: trial.vx, vy: trial.vy,
               z: trial.z, vz: trial.vz, spin: trial.spin };
  const r = simShotRest(b0, trial.flight);
  if (!r) { shotPreview = null; return; }
  if (r.holed) { shotPreview = { holed: true, rest: { x: HOLE.holePos.x, y: HOLE.holePos.y }, yards: 0 }; return; }
  shotPreview = { holed: false, lipped: r.lipped, rest: { x: r.x, y: r.y },
                  yards: dist(state.ball.x, state.ball.y, r.x, r.y) * YARDS_PER_UNIT };
}

// =====================================================================
//  Rendering
// =====================================================================
let ctx = canvas.getContext("2d"); // rebound to an offscreen during the tilted ground capture
// World->screen as a full affine so the camera can ROTATE (each hole plays "up"
// even on the connected global map). screen.x = a*x + b*y + c, screen.y = d*x + e*y + f.
const view = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, scale: 1, angle: 0, tilt: 1 };
const VIEW_PAD_MIN = 3;     // world-unit margin when ball is right by the cup
const VIEW_PAD_FRAC = 0.25; // extra margin as a fraction of the ball->cup span
const VIEW_MIN = 7;         // smallest framed dimension (caps how far we zoom in)
// HUD bands kept clear of the framed hole (css px, added on top of safe-area
// insets). The camera fits the ball↔pin into the area BETWEEN these bands and
// centers it there, so the pin/ball don't sit under the scorecard/stats/club UI.
// Per-device reserve bands. On MOBILE the HUD is a slim top scorecard bar + a
// bottom stat strip (see the mobile-bars CSS in hud.css), so we reserve those
// horizontal bands and give the hole the full screen width. On DESKTOP the HUD
// sits in the corners, so we reserve top/bottom too. Picked in hudReserve().
const HUD_RESERVE = {
  mobile:  { top: 78, bot: 124, side: 10 }, // px: top bar + wind pill / stat strip / gutters
  desktop: { top: 56, bot: 64 },
};
let holeFitW = 100, holeFitH = 100; // full-hole framing dims -> refScale

// Camera = a world focus point + a zoom scale + an angle. Rotation pivots around
// the focus and the target scale is measured at the TARGET angle, so re-aiming
// turns cleanly without wobbling the zoom or drifting the framing.
const camera = {
  focus: { x: WORLD.w / 2, y: WORLD.h / 2 }, scale: 1, angle: 0,
  tFocus: { x: WORLD.w / 2, y: WORLD.h / 2 }, tScale: 1, tAngle: 0,
  // Slightly-3D lean: screen-space y-squash factor (1 = flat). Seeded from the
  // persisted toggle so a reload opens already tilted (no startup animation).
  tilt: tiltView ? TUNE.tiltCos : 1, tTilt: tiltView ? TUNE.tiltCos : 1,
  _w: 100, _h: 100, // last framing dims (for refScale)
};
let cameraAiming = false; // true while smoothly rotating toward camera.tAngle
let aimKey = 0;           // +1 left / -1 right while an arrow key is held (smooth aim)
const AIM_RATE = 1.4 * Math.PI / 180;  // radians/frame while held (~84°/s)
const AIM_NUDGE = 3 * Math.PI / 180;   // fixed step for a single arrow tap

// Pure span/scale math for framing ball<->pin at an arbitrary angle. NOT
// rotation-invariant (the bounding box is measured in the rotated frame), so
// the angle-bucket warp cache calls this per-bucket to get each bucket's own
// correct scale rather than reusing whatever camera.scale happens to be live.
function frameScaleForAngle(angle, ox, oy) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const bx = cos * ox - sin * oy, by = sin * ox + cos * oy;
  const px = cos * HOLE.holePos.x - sin * HOLE.holePos.y, py = sin * HOLE.holePos.x + cos * HOLE.holePos.y;
  const span = Math.max(Math.abs(bx - px), Math.abs(by - py));
  const pad = Math.max(VIEW_PAD_MIN, span * VIEW_PAD_FRAC);
  const w = Math.max(Math.abs(bx - px) + 2 * pad, VIEW_MIN);
  const h = Math.max(Math.abs(by - py) + 2 * pad, VIEW_MIN);
  // Fit into the play area between the HUD bands (not the full screen).
  // The tilt squash shrinks screen height by tTilt, so the vertical fit gains
  // that headroom back — the leaned hole still fills the play area.
  const rsv = hudReserve();
  const availW = Math.max(120, window.innerWidth - rsv.left - rsv.right);
  const availH = Math.max(120, window.innerHeight - rsv.top - rsv.bot);
  return { w, h, scale: Math.min(availW / w, availH / (h * camera.tTilt)) };
}
// Target framing (focus = ball↔pin midpoint; scale = fit ball↔pin + pad at the
// target angle). Tight near the cup (putts), wide off the tee.
function frameTarget(fx, fy) {
  // Focus point defaults to my ball; live spectating passes the opponent's ball.
  const ox = (fx == null) ? state.ball.x : fx, oy = (fy == null) ? state.ball.y : fy;
  const r = frameScaleForAngle(camera.tAngle, ox, oy);
  camera._w = r.w; camera._h = r.h;
  camera.tScale = r.scale;
  camera.tFocus.x = (ox + HOLE.holePos.x) / 2;
  camera.tFocus.y = (oy + HOLE.holePos.y) / 2;
}
function frameRemaining() { frameTarget(); }
// Jump the camera straight to its target (no easing).
function snapCamera() {
  camera.angle = camera.tAngle;
  camera.focus = { x: camera.tFocus.x, y: camera.tFocus.y };
  camera.scale = camera.tScale;
  camera.tilt = camera.tTilt;
  cameraAiming = false;
}

// world->screen affine: screen = scale * R(angle) * (world - focus) + screenCenter.
// With the slightly-3D toggle on, the second row is scaled by tilt — a
// screen-space y-squash (axonometric lean). Staying affine means the aerial
// blit, screenToWorld and the view AABB all keep working unchanged.
// Pure builder (no globals touched) so the angle-bucket warp cache can bake a
// ground raster at an arbitrary discrete angle without disturbing the live
// `view` the rest of draw() reads every frame.
function computeViewMatrix(angle, tilt, scale, focusX, focusY, cssW, cssH) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const m = { scale, angle, tilt };
  m.a = scale * cos; m.b = -scale * sin;
  m.d = scale * sin * tilt; m.e = scale * cos * tilt;
  // Terrain relief factor: 0 when flat, sin(lean)·tExag when fully tilted;
  // fades with the toggle tween. zFocus centers displacement on the camera
  // focus so the framing never jumps between holes or as the ball advances.
  m.kz = tilt >= 0.999 ? 0
       : Math.sqrt(Math.max(0, 1 - tilt * tilt)) * TUNE.tExag
         * Math.min(1, (1 - tilt) / Math.max(1e-6, 1 - TUNE.tiltCos));
  m.zFocus = m.kz ? terrainZ(focusX, focusY) : 0;
  // Center the focus in the play area between the HUD bands, not the raw screen.
  const rsv = hudReserve();
  const cx = (rsv.left + (cssW - rsv.right)) / 2;
  const cy = (rsv.top + (cssH - rsv.bot)) / 2;
  m.c = cx - (m.a * focusX + m.b * focusY);
  m.f = cy - (m.d * focusX + m.e * focusY);
  return m;
}
function applyView() {
  const cssW = window.innerWidth, cssH = window.innerHeight;
  Object.assign(view, computeViewMatrix(
    camera.angle, camera.tilt, camera.scale * (1 + camPunch),
    camera.focus.x, camera.focus.y, cssW, cssH));
  // Apple-ground 3D: build this frame's pinhole (needs the fresh affine above
  // for its look-at center). Null whenever flat — wx/wy stay pure affine.
  view.appleProj = (applePitch > 0.05 && typeof appleGroundActive === "function" && appleGroundActive())
    ? buildAppleProj(cssW, cssH) : null;
}

function angDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

// Ease focus, scale and (while aiming) angle toward their targets each frame.
let _camEaseT = 0;  // last updateCamera timestamp (time-based ease below)
function updateCamera() {
  if (aimKey && (mode === "course" || mode === "range") && canSwing()) {
    camera.tAngle += aimKey * AIM_RATE;     // hold arrow -> rotate directly (stops on release)
    camera.angle = camera.tAngle;
    frameTarget();
    cameraAiming = false;
  } else if (cameraAiming) {
    const d = angDiff(camera.tAngle, camera.angle);
    if (Math.abs(d) < 0.004) { camera.angle = camera.tAngle; cameraAiming = false; }
    else camera.angle += d * 0.16;
  }
  // Time-based ease with a snap. Frame-based easing (+= diff*0.12 per frame)
  // converges per FRAME, so when tilted rebuilds drop fps the tween stretches
  // out in wall time — and every eased frame crosses warpSig's 1/8px quanta,
  // forcing another full ground rebuild (capture + warp + canopy): a death
  // spiral that keeps the warp cache from ever parking. dt-scaled rate keeps
  // convergence wall-clock constant at any fps; the snap ends the asymptotic
  // tail once the residual is sub-visible, so the view matrix goes exactly
  // static and parked tilted frames cost one cache blit.
  const now = performance.now();
  const dt = _camEaseT ? Math.min(now - _camEaseT, 100) : 16.7;
  _camEaseT = now;
  const s = 1 - Math.pow(0.88, dt / 16.7);   // 0.12/frame at 60fps, fps-independent
  const eps = 0.05 / Math.max(camera.scale, 0.001);  // ~1/20 css px in world units
  const ease = (v, t, e) => Math.abs(t - v) < e ? t : v + (t - v) * s;
  camera.focus.x = ease(camera.focus.x, camera.tFocus.x, eps);
  camera.focus.y = ease(camera.focus.y, camera.tFocus.y, eps);
  camera.scale = ease(camera.scale, camera.tScale, camera.scale * 1e-4);
  camera.tilt = ease(camera.tilt, camera.tTilt, 1e-4);
  // Apple-ground courses tilt the REAL camera (MKMapCamera pitch), never the
  // canvas squash — the squash would corrupt the pinhole replica's affine base.
  if (appleGroundActive()) {
    camera.tilt = camera.tTilt = 1;
    // Cap zoom so the camera never requests under flyover's minimum distance
    // (past the clamp the map drifts off the overlay — see APPLE_MIN_DIST_M).
    const sMax = window.innerHeight * M_PER_UNIT * APPLE_CAM_K / APPLE_MIN_DIST_M;
    if (camera.scale > sMax) camera.scale = sMax;
    if (camera.tScale > sMax) camera.tScale = sMax;
    // Pitch rides the zoom: full 3D at hole-scale framings, easing to flat
    // by putt zoom. Two reasons in one knob — top-down is the better read on
    // the green anyway, and the replica-vs-flyover residual (terrain
    // anchoring, no exact-projection API — see buildAppleProj) grows with
    // tan(pitch) exactly where alignment matters most.
    const distNow = window.innerHeight / camera.scale * M_PER_UNIT * APPLE_CAM_K;
    const ramp = Math.min(1, Math.max(0, (distNow - 220) / (380 - 220)));
    applePitchT = tiltView ? TUNE.applePitchDeg * ramp : 0;
  } else {
    applePitchT = 0;
  }
  applePitch = ease(applePitch, applePitchT, 0.05);
  if (camPunch > 0.0005) camPunch *= 0.82; else camPunch = 0;  // ease the punch back
  applyView();
}

// Visible world rect (axis-aligned; used by the vector renderer at angle≈0).
// Matches applyView's play-area centering so stripe ranges cover the full screen.
function visibleRect() {
  const s = camera.scale, sy = s * camera.tilt, cssW = window.innerWidth;
  const cssH = window.innerHeight + 2 * _capPad; // capture pad: cover the warp bands too
  const rsv = hudReserve();
  const cx = (rsv.left + (cssW - rsv.right)) / 2;
  const cy = (rsv.top + (window.innerHeight - rsv.bot)) / 2 + _capPad;
  return { x: camera.focus.x - cx / s, w: cssW / s,
           y: camera.focus.y - cy / sy, h: cssH / sy };
}

// Safe-area insets (notch / Dynamic Island / home indicator). The DOM HUD uses
// env(safe-area-inset-*) directly; canvas-drawn HUD reads these cached px so it
// doesn't land under the notch. Re-read on resize (rotation changes them).
let safeInset = { t: 0, r: 0, b: 0, l: 0 };
function readSafeInsets() {
  const cs = getComputedStyle(document.documentElement);
  safeInset = {
    t: parseFloat(cs.getPropertyValue("--sat")) || 0,
    r: parseFloat(cs.getPropertyValue("--sar")) || 0,
    b: parseFloat(cs.getPropertyValue("--sab")) || 0,
    l: parseFloat(cs.getPropertyValue("--sal")) || 0,
  };
}
// Device mode: single source of truth for mobile vs desktop, driving BOTH the
// DOM panels (body.is-mobile/.is-desktop -> CSS) and the canvas HUD (IS_DESKTOP).
// matchMedia so it live-updates on resize/rotation. A coarse-pointer touchscreen
// laptop counts as mobile here (desired for a swing game).
const mqMobile = window.matchMedia("(pointer: coarse), (max-width: 820px)");
let IS_DESKTOP = false;
function applyDeviceMode() {
  const mobile = mqMobile.matches;
  IS_DESKTOP = !mobile;
  document.body.classList.toggle("is-mobile", mobile);
  document.body.classList.toggle("is-desktop", !mobile);
  // Touch players never see the keyboard half of the swing hint.
  const hint = document.getElementById("hint");
  if (hint) hint.textContent = mobile
    ? "Swipe to swing"
    : "Swipe to swing · ← → to aim · ↑ ↓ club";
}
mqMobile.addEventListener("change", () => { applyDeviceMode(); resize(); });

// HUD bands (px) the camera keeps the framed hole clear of: safe-area inset + the
// per-device reserve on each edge. Top/bottom hold the scorecard/stats and club UI.
function hudReserve() {
  if (!IS_DESKTOP) {
    // Mobile: HUD is a top bar + bottom strip -> reserve those, use full width.
    const m = HUD_RESERVE.mobile;
    return {
      top: safeInset.t + m.top,
      bot: safeInset.b + m.bot,
      left: safeInset.l + m.side,
      right: safeInset.r + m.side,
    };
  }
  const r = HUD_RESERVE.desktop;
  return {
    top: safeInset.t + r.top,
    bot: safeInset.b + r.bot,
    left: safeInset.l,
    right: safeInset.r,
  };
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  readSafeInsets();
  // fixed swing sensitivity: full-hole fit, independent of the camera zoom
  refScale = Math.min(cssW / holeFitW, cssH / holeFitH);
  applyView();
  if (typeof clampHudPositions === "function") clampHudPositions(); // keep moved panels on-screen
  if (typeof positionStatsBar === "function") positionStatsBar();   // re-dock shot info under the top bar
  // Re-anchor the swing hint above the ball if the viewport changed while it's
  // still showing (orientation flip before the player's first swing).
  if (elHint && hudVis.hint && !elHint.classList.contains("hidden")) positionHint();
}
window.addEventListener("resize", resize);

// Apple-ground 3D (view.appleProj set): every overlay vertex routes through
// the MapKit pinhole replica instead of the affine — see buildAppleProj.
// Tiny memo: wx/wy are always called as a pair on the same point.
let _apLast = null;
// Terrain height under a world point, relative to the camera's anchor plane
// (world units) — what a GROUND point's z is in the pinhole projection.
// Two parts: local DEM relief relative to the look-at point, MINUS the
// constant height MapKit's pivot floats above its own rendered terrain
// (APPLE_ANCHOR_DROP_M — see there).
function _apGroundZ(P, x, y) {
  const dropM = typeof window.__appleDrop === "number" ? window.__appleDrop : APPLE_ANCHOR_DROP_M;
  return terrainZ(x, y) - P.zAnchor - dropM / P.m;
}
function _apPt(x, y) {
  if (_apLast && _apLast.wx === x && _apLast.wy === y && _apLast.P === view.appleProj) return _apLast;
  const P = view.appleProj;
  const q = appleProjPt(P, x, y, _apGroundZ(P, x, y));
  _apLast = { wx: x, wy: y, P, x: q.x, y: q.y };
  return _apLast;
}
function wx(x, y) { return view.appleProj ? _apPt(x, y).x : view.a * x + view.b * y + view.c; }
function wy(x, y) { return view.appleProj ? _apPt(x, y).y : view.d * x + view.e * y + view.f; }
function ws(v) { return v * view.scale; }
// Inverse: screen px -> world coords (for the range finder).
function screenToWorld(sx, sy) {
  if (view.appleProj) return appleUnproject(view.appleProj, sx, sy);
  const det = view.a * view.e - view.b * view.d || 1;
  const x = sx - view.c, y = sy - view.f;
  return { x: (view.e * x - view.b * y) / det, y: (-view.d * x + view.a * y) / det };
}
// --- Terrain relief (tilted view) --------------------------------------
// DEM elevation in WORLD UNITS (1 unit = 3 yds = 2.743 m). 0 without a DEM.
const M_PER_UNIT = 2.7432;
function terrainZ(x, y) {
  if (!HOLE) return 0;
  // Real baked DEM if the course has one (metres -> world units); else 0.
  let z = HOLE._dem ? HOLE._dem.elevAt(x, y) / M_PER_UNIT : 0;
  z += broadTerrainZ(x, y);   // low-freq cosmetic swells (0 = off)
  z += greenUndZ(x, y);       // per-green roll, bbox short-circuit
  return z;
}
// Green undulation as real vertical elevation (world units). The green field
// (g.h) already exists for contours/shading — here it also physically rolls the
// surface in the tilted view so break can be read by eye. Mean subtracted so the
// green rolls in place (doesn't pop up/down as a slab); smoothstep falloff past
// the bbox so surrounding fairway isn't creased. Loops greens with an AABB reject
// (usually 0-1 hits); expanded bbox memoized per green.
function greenUndZ(x, y) {
  const gs = HOLE && HOLE._greens;
  if (!gs || !TUNE.gUndOn) return 0;
  let z = 0;
  for (const g of gs) {
    let b = g._zbb;
    if (!b) {
      const p = polyBBox(g.poly), f = TUNE.gUndFall;
      b = g._zbb = { minx: p.minx - f, maxx: p.maxx + f, miny: p.miny - f, maxy: p.maxy + f,
                     ix0: p.minx, ix1: p.maxx, iy0: p.miny, iy1: p.maxy,
                     hmid: (g.hmin + g.hmax) * 0.5 };
    }
    if (x < b.minx || x > b.maxx || y < b.miny || y > b.maxy) continue;
    // Smoothstep weight: 1 inside the green bbox, easing to 0 at the expanded edge.
    const dx = Math.max(0, b.ix0 - x, x - b.ix1);
    const dy = Math.max(0, b.iy0 - y, y - b.iy1);
    const d = Math.hypot(dx, dy);
    if (d >= TUNE.gUndFall) continue;
    const t = 1 - d / TUNE.gUndFall, w = t * t * (3 - 2 * t); // smoothstep, C1
    z += (g.h(x, y) - b.hmid) * TUNE.gUndScale * TUNE.gUndExag * w;
  }
  return z;
}
// Broad, gentle, deterministic terrain swells course-wide (world units). Purely
// COSMETIC — off-green ball roll never reads terrainZ, so these swells add 3D feel
// to fairways without changing play. Seeded value noise (hashSeed lattice, bilinear
// + smoothstep interp). gBroadAmp <= 0 disables entirely.
function broadTerrainZ(x, y) {
  const amp = TUNE.gBroadAmp;
  if (!(amp > 0)) return 0;
  const wl = TUNE.gBroadWL || 130;
  const gx = x / wl, gy = y / wl;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const n00 = hashSeed(x0, y0), n10 = hashSeed(x0 + 1, y0);
  const n01 = hashSeed(x0, y0 + 1), n11 = hashSeed(x0 + 1, y0 + 1);
  const nx0 = n00 + (n10 - n00) * sx, nx1 = n01 + (n11 - n01) * sx;
  const v = nx0 + (nx1 - nx0) * sy; // 0..1
  return (v - 0.5) * 2 * amp;
}
// Screen-y lift of the ground at a world point. view.kz (set each frame in
// applyView) folds sin(lean)·tExag·tilt-fade into one factor; zero when flat,
// so every caller collapses back to today's rendering with no branches.
function liftAt(x, y) {
  return view.kz ? (terrainZ(x, y) - view.zFocus) * view.scale * view.kz : 0;
}
// Ground-anchored screen y: wy + terrain displacement. Use for anything that
// sits ON the ground (cup, flag base, ball shadow, markers, trees).
function wyg(x, y) { return wy(x, y) - liftAt(x, y); }
// Inverse that accounts for the terrain lift (taps on a displaced slope land
// where the eye sees them). Two fixed-point iterations are plenty — lift
// varies slowly (DEM cells are ~6 yds).
function screenToWorldGround(sx, sy) {
  let p = screenToWorld(sx, sy);
  for (let i = 0; i < 2; i++) p = screenToWorld(sx, sy + liftAt(p.x, p.y));
  return p;
}
// Pill label centered at (x,y) — used by the range finder.
function drawLabel(x, y, text, color) {
  ctx.font = "600 13px -apple-system, BlinkMacSystemFont, sans-serif";
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 11, w, 22, 7);
  else ctx.rect(x - w / 2, y - 11, w, 22);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// Off-screen culling: AABB of the (possibly rotated) viewport in world coords,
// recomputed once per frame. Polygons outside it are skipped — vital for the
// global connected course, which holds the WHOLE course's geometry.
let _viewAABB = null;
function computeViewAABB() {
  const cssW = window.innerWidth, cssH = window.innerHeight;
  // Tilted: extend vertically so polys feeding the warp pad bands (and trees
  // taller than the viewport edge) aren't culled away.
  const py = _warpPad + (view.kz ? ws(TUNE.treeHMax) * view.kz : 0);
  const c = [screenToWorld(0, -py), screenToWorld(cssW, -py), screenToWorld(cssW, cssH + py), screenToWorld(0, cssH + py)];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of c) {
    if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
  }
  _viewAABB = { minx, miny, maxx, maxy };
}
function polyVisible(poly) {
  if (!_viewAABB || !poly || poly.length < 2) return true;
  const bb = poly._bb || (poly._bb = polyBBox(poly)); // memoized
  const v = _viewAABB;
  return bb.maxx >= v.minx && bb.minx <= v.maxx && bb.maxy >= v.miny && bb.miny <= v.maxy;
}

function fillPoly(poly, color) {
  if (!poly || poly.length < 2 || !polyVisible(poly)) return;
  ctx.beginPath();
  ctx.moveTo(wx(poly[0].x, poly[0].y), wy(poly[0].x, poly[0].y));
  for (let i = 1; i < poly.length; i++) ctx.lineTo(wx(poly[i].x, poly[i].y), wy(poly[i].x, poly[i].y));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function fillPolys(polys, color) {
  if (!polys) return;
  for (let i = 0; i < polys.length; i++) fillPoly(polys[i], color);
}
// Fill many polygons as ONE path (single fill, nonzero winding) so overlapping
// polys don't stack translucent alpha into bands — the union reads as one flat
// wash. Off-screen polys are culled. Use for translucent surface tints where
// per-poly fillPolys would double-paint the overlaps.
function fillPolysUnion(polys, color, feather) {
  if (!polys || !polys.length) return;
  ctx.beginPath();
  let any = false;
  for (const poly of polys) {
    if (!poly || poly.length < 2 || !polyVisible(poly)) continue;
    ctx.moveTo(wx(poly[0].x, poly[0].y), wy(poly[0].x, poly[0].y));
    for (let i = 1; i < poly.length; i++) ctx.lineTo(wx(poly[i].x, poly[i].y), wy(poly[i].x, poly[i].y));
    ctx.closePath();
    any = true;
  }
  if (!any) return;
  ctx.fillStyle = color;
  // feather (css px): soften the union outline so a synthesized-corridor
  // boundary reads as a gradient, not a sawtooth. Guarded — Safari <18 no-ops
  // ctx.filter, which just falls back to a crisp (still band-free) edge.
  const canFeather = feather && "filter" in ctx;
  if (canFeather) ctx.filter = "blur(" + feather + "px)";
  ctx.fill();  // nonzero winding: each pixel painted once, overlaps included
  if (canFeather) ctx.filter = "none";
}

// --- Aesthetic helpers --------------------------------------------------
function tracePoly(poly) {
  ctx.beginPath();
  ctx.moveTo(wx(poly[0].x, poly[0].y), wy(poly[0].x, poly[0].y));
  for (let i = 1; i < poly.length; i++) ctx.lineTo(wx(poly[i].x, poly[i].y), wy(poly[i].x, poly[i].y));
  ctx.closePath();
}
// Run fn with the canvas clipped to a polygon (for textures/stripes/gradients).
function withClip(poly, fn) {
  if (!poly || poly.length < 2) return;
  ctx.save();
  tracePoly(poly);
  ctx.clip();
  fn();
  ctx.restore();
}
// Chaikin corner-cutting — rounds an angular polygon into an organic curve.
// Closed ring: each pass replaces every vertex with points at 1/4 and 3/4 of
// each edge. Two passes turn OSM's straight-edged greens smooth.
function chaikinClosed(poly, iters = 2) {
  let p = poly;
  for (let k = 0; k < iters; k++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
             { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    p = q;
  }
  return p;
}
// Open-polyline variant (endpoints stay pinned) — for contour lines.
function chaikinOpen(pts, iters = 2) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    if (p.length < 3) return p;
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
             { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
// Round the green polygons once per surfaces object. Render AND physics share
// the result, so the smoothed edge is also the edge the ball putts from.
function roundGreens(surfaces) {
  if (!surfaces || surfaces._greensRounded) return;
  surfaces._greensRounded = true;
  if (surfaces.green)
    surfaces.green = surfaces.green.map((p) => (p.length >= 3 ? chaikinClosed(p) : p));
}
// Link marching-squares segments into polylines so contours can be smoothed
// (raw per-cell segments draw as kinked chains of tiny straights).
function chainSegs(segs) {
  const key = (x, y) => Math.round(x * 1024) + "," + Math.round(y * 1024);
  const ends = new Map(); // endpoint key -> [{i, rev}]
  const add = (k, v) => { const a = ends.get(k); if (a) a.push(v); else ends.set(k, [v]); };
  segs.forEach((s, i) => { add(key(s.ax, s.ay), { i, rev: false }); add(key(s.bx, s.by), { i, rev: true }); });
  const used = new Array(segs.length).fill(false);
  const takeFrom = (k) => {
    const cands = ends.get(k);
    if (cands) for (const c of cands) {
      if (used[c.i]) continue;
      used[c.i] = true;
      const s = segs[c.i];
      return c.rev ? { x: s.ax, y: s.ay } : { x: s.bx, y: s.by };
    }
    return null;
  };
  const paths = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const s = segs[i];
    const path = [{ x: s.ax, y: s.ay }, { x: s.bx, y: s.by }];
    for (;;) { const e = path[path.length - 1], n = takeFrom(key(e.x, e.y)); if (!n) break; path.push(n); }
    for (;;) { const e = path[0], n = takeFrom(key(e.x, e.y)); if (!n) break; path.unshift(n); }
    paths.push(path);
  }
  return paths;
}
function polyBBox(poly) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, cx = 0, cy = 0;
  for (const p of poly) {
    if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
    cx += p.x; cy += p.y;
  }
  return { minx, miny, maxx, maxy, cx: cx / poly.length, cy: cy / poly.length };
}
// Mowing stripes: alternating bands across the currently visible world rect.
// axis "y" => horizontal bands; axis "x" => vertical bands.
function stripes(c1, c2, bandW, axis) {
  const r = visibleRect(), cssW = window.innerWidth, cssH = window.innerHeight + 2 * _capPad;
  if (axis === "x") {
    for (let x = Math.floor(r.x / bandW) * bandW; x < r.x + r.w; x += bandW) {
      ctx.fillStyle = (Math.floor(x / bandW) & 1) ? c1 : c2;
      ctx.fillRect(wx(x, 0), 0, ws(bandW) + 1, cssH);
    }
  } else {
    for (let y = Math.floor(r.y / bandW) * bandW; y < r.y + r.h; y += bandW) {
      ctx.fillStyle = (Math.floor(y / bandW) & 1) ? c1 : c2;
      ctx.fillRect(0, wy(0, y), cssW, ws(bandW) + 1);
    }
  }
}

// Build a bilinear DEM sampler from a baked elevation grid.
// dem.data[j*nx+i] = elevation in metres above baseElevM, at world (x,y):
//   x = x0 + i*(x1-x0)/(nx-1),  y = y0 + j*(y1-y0)/(ny-1)
function buildDEM(d) {
  const { nx, ny, data } = d;
  const x0 = d.x0, y0 = d.y0, x1 = d.x1, y1 = d.y1;
  const dx = (x1 - x0) / (nx - 1), dy = (y1 - y0) / (ny - 1);
  function sample(x, y) {
    const xi = (x - x0) / dx, yi = (y - y0) / dy;
    const x0i = Math.max(0, Math.min(nx - 2, Math.floor(xi)));
    const y0i = Math.max(0, Math.min(ny - 2, Math.floor(yi)));
    const fx = xi - x0i, fy = yi - y0i;
    const i00 = y0i * nx + x0i;
    return (data[i00]       * (1-fx) * (1-fy) +
            data[i00+1]     *    fx  * (1-fy) +
            data[i00+nx]    * (1-fx) *    fy  +
            data[i00+nx+1]  *    fx  *    fy);
  }
  const EPS = dx * 0.5;
  function gradAt(x, y) {
    return {
      x: (sample(x + EPS, y) - sample(x - EPS, y)) / (2 * EPS),
      y: (sample(x, y + EPS) - sample(x, y - EPS)) / (2 * EPS),
    };
  }
  return { elevAt: sample, gradAt };
}

// --- Topographical green: synthesize a smooth height field + contour lines.
// OSM has no elevation, so we fabricate a gentle, DETERMINISTIC surface per
// green (stable across frames). When a DEM is available, use real elevation
// instead. The SAME field drives both drawn contours and putting break
// (greenSlopeAt / rollStep), so what you see is what breaks.
function hashSeed(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function lerpT(a, b, L) {
  const d = b - a;
  return d === 0 ? 0.5 : Math.min(1, Math.max(0, (L - a) / d));
}
// Marching squares over a world-space grid -> contour segments at each level.
function contourSegments(h, x0, y0, x1, y1, levels, nx, ny) {
  const segs = [];
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
  const H = [];
  for (let j = 0; j <= ny; j++) {
    H[j] = [];
    for (let i = 0; i <= nx; i++) H[j][i] = h(x0 + i * dx, y0 + j * dy);
  }
  for (const L of levels) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const xL = x0 + i * dx, yT = y0 + j * dy, xR = xL + dx, yB = yT + dy;
        const tl = H[j][i], tr = H[j][i + 1], br = H[j + 1][i + 1], bl = H[j + 1][i];
        const cT = (tl > L) !== (tr > L), cR = (tr > L) !== (br > L);
        const cB = (br > L) !== (bl > L), cLe = (bl > L) !== (tl > L);
        const pts = {};
        if (cT) pts.T = { x: xL + dx * lerpT(tl, tr, L), y: yT };
        if (cR) pts.R = { x: xR, y: yT + dy * lerpT(tr, br, L) };
        if (cB) pts.B = { x: xL + dx * lerpT(bl, br, L), y: yB };
        if (cLe) pts.L = { x: xL, y: yT + dy * lerpT(tl, bl, L) };
        const k = Object.keys(pts);
        if (k.length === 2) {
          segs.push({ ax: pts[k[0]].x, ay: pts[k[0]].y, bx: pts[k[1]].x, by: pts[k[1]].y });
        } else if (k.length === 4) { // saddle — connect T-R and B-L
          segs.push({ ax: pts.T.x, ay: pts.T.y, bx: pts.R.x, by: pts.R.y });
          segs.push({ ax: pts.B.x, ay: pts.B.y, bx: pts.L.x, by: pts.L.y });
        }
      }
    }
  }
  return segs;
}
// Precompute per-green topo (height field + contour segments in world coords).
// Pass `dem` (from buildDEM) to use real elevation; omit for synthetic fallback.
// `opts` (course JSON `greenTopo`) tunes the synthetic field's difficulty:
//   { tiltMul, undAmp, lobes } — tilt multiplier, undulation amplitude
//   multiplier, and number of sin×cos lobes (>1 = multi-break shelves).
function buildGreenTopo(polys, dem, opts) {
  const out = [];
  if (!polys) return out;
  for (const poly of polys) {
    if (poly.length < 3) continue;
    const bb = polyBBox(poly);
    const R = Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny) / 2 || 1;
    let h, grad, hi, lo;
    if (dem) {
      // Real elevation: shift so the green centroid is zero, then use DEM.
      const base = dem.elevAt(bb.cx, bb.cy);
      h = (x, y) => dem.elevAt(x, y) - base;
      grad = (x, y) => dem.gradAt(x, y);
      // hi/lo: approximate dominant slope direction from centroid gradient
      const cg = dem.gradAt(bb.cx, bb.cy), cgm = Math.hypot(cg.x, cg.y) || 1;
      hi = { x: bb.cx - cg.x / cgm * R, y: bb.cy - cg.y / cgm * R };
      lo = { x: bb.cx + cg.x / cgm * R, y: bb.cy + cg.y / cgm * R };
    } else {
      const o = opts || {};
      const r1 = hashSeed(bb.cx, bb.cy), r2 = hashSeed(bb.cy, bb.cx), r3 = hashSeed(bb.cx + 7.3, bb.cy - 2.1);
      const theta = r1 * Math.PI * 2;
      const tmag = (0.6 + 0.5 * r2) * (o.tiltMul || 1);
      const dirx = Math.cos(theta), diry = Math.sin(theta);
      // Undulation lobes: lobe 0 is the classic single sin×cos; extra lobes
      // (course-requested) are shorter-wavelength, lower-amplitude harmonics
      // that add shelves/tiers — true multi-break.
      const amp0 = 0.5 * (o.undAmp || 1);
      const lobes = [];
      for (let li = 0, nLb = Math.max(1, o.lobes || 1); li < nLb; li++) {
        const rs = li === 0 ? r3 : hashSeed(bb.cx * (li + 1.7) - 3.1, bb.cy * (li + 0.6) + 11.4);
        lobes.push({
          wl: R * (0.7 + 0.6 * rs) / (1 + li * 0.9),
          ph: rs * 6.2831,
          amp: amp0 * Math.pow(0.62, li),
        });
      }
      h = (x, y) => {
        const along = ((x - bb.cx) * dirx + (y - bb.cy) * diry) / R;
        let und = 0;
        for (const L of lobes) und += L.amp * Math.sin((x - bb.cx) / L.wl + L.ph) * Math.cos((y - bb.cy) / L.wl - L.ph);
        return tmag * along + und;
      };
      grad = (x, y) => {
        let gx = tmag * dirx / R, gy = tmag * diry / R;
        for (const L of lobes) {
          gx += L.amp * Math.cos((x - bb.cx) / L.wl + L.ph) * Math.cos((y - bb.cy) / L.wl - L.ph) / L.wl;
          gy -= L.amp * Math.sin((x - bb.cx) / L.wl + L.ph) * Math.sin((y - bb.cy) / L.wl - L.ph) / L.wl;
        }
        return { x: gx, y: gy };
      };
      hi = { x: bb.cx + dirx * R, y: bb.cy + diry * R };
      lo = { x: bb.cx - dirx * R, y: bb.cy - diry * R };
    }
    let hmin = Infinity, hmax = -Infinity, gmax = 1e-6;
    const N = 22;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const sx = bb.minx + (bb.maxx - bb.minx) * i / N, sy = bb.miny + (bb.maxy - bb.miny) * j / N;
      const v = h(sx, sy);
      if (v < hmin) hmin = v; if (v > hmax) hmax = v;
      const gv = grad(sx, sy), gm = Math.hypot(gv.x, gv.y);
      if (gm > gmax) gmax = gm;
    }
    const nL = 7, levels = [];
    for (let kk = 1; kk <= nL; kk++) levels.push(hmin + (hmax - hmin) * kk / (nL + 1));
    // Chain each level's marching-squares segments into polylines and round
    // them (Chaikin) so contours draw as flowing curves, not kinked cells.
    const contours = [];
    for (const L of levels) {
      const segs = contourSegments(h, bb.minx, bb.miny, bb.maxx, bb.maxy, [L], 30, 30);
      for (const path of chainSegs(segs)) {
        const a = path[0], b = path[path.length - 1];
        const closed = path.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) < 1e-4;
        contours.push(closed
          ? { pts: chaikinClosed(path.slice(0, -1)), closed: true }
          : { pts: chaikinOpen(path), closed: false });
      }
    }
    out.push({ poly, contours, h, grad, gmax, hmin, hmax, hi, lo });
  }
  return out;
}

function strokePolyline(poly) {
  if (!poly || poly.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(wx(poly[0].x, poly[0].y), wy(poly[0].x, poly[0].y));
  for (let i = 1; i < poly.length; i++) ctx.lineTo(wx(poly[i].x, poly[i].y), wy(poly[i].x, poly[i].y));
  ctx.stroke();
}

// Draw the baked north-up aerial as the hole base, mapped image-px -> world ->
// screen via the stored affine. The global canvas transform is dpr-scaled, so
// we compose dpr * (view ∘ toWorld) and draw the image, then restore.
// Bake the grade + course-green wash into the aerial ONCE (offscreen) so each
// frame is a plain drawImage — no per-frame ctx.filter / blend on a huge photo.
function bakeAerial(img, up) {
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * up); c.height = Math.round(img.height * up);
  const g = c.getContext("2d");
  if (!g || !c.width || !c.height) return null;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.filter = "saturate(1.35) contrast(1.05) brightness(1.02)";
  g.drawImage(img, 0, 0, c.width, c.height);
  g.filter = "none";
  g.globalCompositeOperation = "color";       // recolor toward course-green
  g.globalAlpha = 0.45; g.fillStyle = "#5a8f3c"; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "soft-light";  // deepen midtones
  g.globalAlpha = 0.5; g.fillStyle = "#3f7a34"; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-over"; // faint darken
  g.globalAlpha = 0.08; g.fillStyle = "#23461e"; g.fillRect(0, 0, c.width, c.height);
  c._up = up; // px density vs the source aerial — drawAerial folds this out
  return c;
}
function processAerial(img) {
  // Bake at 1.5x: the extra octave keeps the deep-zoom resample smooth (real
  // detail is capped by the source imagery, this only tames bilinear blocking).
  // Oversize canvases can fail SILENTLY (iOS area limits), so probe a center
  // pixel and fall back to a native-res bake.
  try {
    const c = bakeAerial(img, 1.5);
    if (c && c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] > 0)
      return c;
  } catch (e) { /* fall through to 1x */ }
  return bakeAerial(img, 1);
}

function drawAerial() {
  const a = HOLE.aerial, img = HOLE._img;
  if (!a || !img) return;
  const m = a.toWorld, dpr = window.devicePixelRatio || 1;
  const up = img._up || 1;   // supersampled bake: canvas px are up× denser than source px
  const m0 = m[0] / up, m1 = m[1] / up, m3 = m[3] / up, m4 = m[4] / up;
  // compose pixel -> world (m) with world -> screen (view affine): screen = view ∘ m
  const A = view.a * m0 + view.b * m3;            // px coef in screen.x
  const C = view.a * m1 + view.b * m4;            // py coef in screen.x
  const E = view.a * m[2] + view.b * m[5] + view.c;
  const B = view.d * m0 + view.e * m3;            // px coef in screen.y
  const D = view.d * m1 + view.e * m4;            // py coef in screen.y
  const F = view.d * m[2] + view.e * m[5] + view.f;
  ctx.save();
  ctx.setTransform(dpr * A, dpr * B, dpr * C, dpr * D, dpr * E, dpr * F);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Draw only the visible pixel sub-rect, not the whole (often 2000²+) global
  // aerial. The camera is zoomed into one hole, so most of the image is off
  // screen; sampling all of it every frame is the main render cost. Invert the
  // pixel→css affine [[A,C],[B,D]] to map the 4 screen corners back to image
  // pixels, take their bounding box, clamp to the image, and crop to that.
  const cssW = window.innerWidth, cssH = window.innerHeight + 2 * _capPad;
  const det = A * D - C * B;
  if (Math.abs(det) > 1e-9) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [scx, scy] of [[0, 0], [cssW, 0], [0, cssH], [cssW, cssH]]) {
      const dx = scx - E, dy = scy - F;
      const px = (D * dx - C * dy) / det;
      const py = (-B * dx + A * dy) / det;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    const sx = Math.max(0, Math.floor(minX) - 1);
    const sy = Math.max(0, Math.floor(minY) - 1);
    const sw = Math.min(img.width, Math.ceil(maxX) + 1) - sx;
    const sh = Math.min(img.height, Math.ceil(maxY) + 1) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
  } else {
    ctx.drawImage(img, 0, 0); // degenerate transform: fall back to full draw
  }
  ctx.restore();
}

// --- Anti-pixelation detail grain --------------------------------------------
// The aerial tops out around 0.6 m/px; the putt camera stretches that 30-40x
// across the screen and no resampling can invent the missing detail. So once
// the photo is magnified past its native resolution, a world-anchored
// procedural turf grain fades in on top (soft-light over the aerial) — the
// classic terrain "detail texture" trick. World-anchored means it sticks to
// the ground through pan/rotate/tilt; crisp vector overlays draw above it.
let _grain = null; // { canvas, size, pattern }
function grainTile() {
  if (_grain) return _grain;
  const S = 256, c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d"), id = g.createImageData(S, S);
  const rnd = mulberry32(0x51ee7);
  // Two-octave tileable value noise: random lattices sampled with wrap, so the
  // 256px tile repeats seamlessly. Neutral 128 gray = invisible under soft-light.
  const lat = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < n * n; i++) a[i] = rnd(); return a; };
  const l1 = lat(64), l2 = lat(16);
  const samp = (a, n, x, y) => {
    const fx = x * n / S, fy = y * n / S;
    const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    return (a[y0 * n + x0] * (1 - tx) + a[y0 * n + x1] * tx) * (1 - ty)
         + (a[y1 * n + x0] * (1 - tx) + a[y1 * n + x1] * tx) * ty;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0.62 * samp(l1, 64, x, y) + 0.38 * samp(l2, 16, x, y);
    v += 0.08 * Math.sin((x + y) * Math.PI * 8 / S);   // faint diagonal mow streak
    const lum = Math.max(0, Math.min(255, Math.round(128 + (v - 0.5) * 110)));
    const i = (y * S + x) * 4;
    id.data[i] = lum; id.data[i + 1] = lum; id.data[i + 2] = lum; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  _grain = { canvas: c, size: S, pattern: null };
  return _grain;
}
function drawDetailGrain() {
  const a = HOLE.aerial;
  if (!a || !HOLE._img) return;
  if (_warpMotion) return; // full-screen soft-light fill: skip while the camera
                           // moves (subtle layer, invisible pop, big fill save)
  const dpr = window.devicePixelRatio || 1;
  // Magnification k = device px per SOURCE aerial px (the 1.5x bake adds no
  // real detail, so it doesn't count). Below the ramp the photo still has
  // native texture and the grain stays fully off.
  const k = dpr * view.scale * Math.hypot(a.toWorld[0], a.toWorld[3]);
  const t = (k - TUNE.detailRampLo) / (TUNE.detailRampHi - TUNE.detailRampLo);
  const alpha = TUNE.detailAlpha * Math.max(0, Math.min(1, t));
  if (alpha < 0.01) return;
  const gr = grainTile();
  if (!gr.pattern) gr.pattern = ctx.createPattern(gr.canvas, "repeat");
  const u = TUNE.detailTileUnits / gr.size;   // world units per tile px
  // tile px -> css: same view compose as drawAerial, with m = scale(u)
  const A = view.a * u, C = view.b * u, E = view.c;
  const B = view.d * u, D = view.e * u, F = view.f;
  const det = A * D - C * B;
  if (Math.abs(det) < 1e-12) return;
  // visible screen corners -> tile-space AABB (pattern repeats, no clamp needed)
  const cssW = window.innerWidth, cssH = window.innerHeight + 2 * _capPad;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [scx, scy] of [[0, 0], [cssW, 0], [0, cssH], [cssW, cssH]]) {
    const dx = scx - E, dy = scy - F;
    const px = (D * dx - C * dy) / det;
    const py = (-B * dx + A * dy) / det;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  ctx.save();
  ctx.setTransform(dpr * A, dpr * B, dpr * C, dpr * D, dpr * E, dpr * F);
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gr.pattern;
  ctx.fillRect(minX - 1, minY - 1, (maxX - minX) + 2, (maxY - minY) + 2);
  ctx.restore();
}

// Green: collar + fill + topo contours. `photo` => translucent over the aerial.
function drawGreen(photo) {
  const cssW = window.innerWidth, cssH = window.innerHeight + 2 * _capPad, s = HOLE.surfaces;
  ctx.strokeStyle = photo ? "rgba(190,235,195,0.25)" : "rgba(90,165,99,0.35)";
  ctx.lineWidth = ws(photo ? 1.2 : 1.5);
  ctx.lineJoin = "round";
  for (const poly of s.green || []) { if (!polyVisible(poly)) continue; tracePoly(poly); ctx.stroke(); }
  for (const g of HOLE._greens || []) {
    if (!polyVisible(g.poly)) continue; // skip off-screen greens (incl. their topo)
    withClip(g.poly, () => {
      if (photo) {
        ctx.globalAlpha = 0.13;          // light tint — let the real turf show through
        ctx.fillStyle = "#7ecb86";
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.globalAlpha = 1;
      } else {
        const lg = ctx.createLinearGradient(wx(g.hi.x, g.hi.y), wy(g.hi.x, g.hi.y), wx(g.lo.x, g.lo.y), wy(g.lo.x, g.lo.y));
        lg.addColorStop(0, "#92d398");
        lg.addColorStop(1, "#6fbb79");
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.globalAlpha = 0.5;
        stripes("rgba(255,255,255,0.10)", "rgba(0,0,0,0.06)", 3, "x");
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = photo ? "rgba(30,60,35,0.26)" : "rgba(32,74,38,0.40)";
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const c of g.contours) {
        const p = c.pts;
        ctx.moveTo(wx(p[0].x, p[0].y), wy(p[0].x, p[0].y));
        for (let i = 1; i < p.length; i++) ctx.lineTo(wx(p[i].x, p[i].y), wy(p[i].x, p[i].y));
        if (c.closed) ctx.closePath();
      }
      ctx.stroke();
    });
  }
}

// --- Subtle shaded-relief topo (replaces the loud rainbow heatmap) ---
// Soft hillshade (light/shadow on the undulations) + a whisper of warm tint on the
// steepest spots + thin fall-line arrows. Shown only on the green in play and the
// target green; faint always-on (ambient), boosted to full detail by the slope button.

// Downhill fall-line arrow at a world point (rotates with the camera via wx/wy).
// Constant screen-space line width so it reads at any zoom.
function drawFallArrow(x, y, grad, t) {
  const gm = Math.hypot(grad.x, grad.y) || 1e-6;
  const dx = -grad.x / gm, dy = -grad.y / gm;         // unit downhill direction
  const len = 0.45 + 0.7 * t;                         // world units; steeper = longer
  const hx = x + dx * len, hy = y + dy * len;         // arrow head (downhill end)
  const sx = wx(x, y), sy = wy(x, y), ex = wx(hx, hy), ey = wy(hx, hy);
  const ux = ex - sx, uy = ey - sy, ul = Math.hypot(ux, uy) || 1;
  const nx = ux / ul, ny = uy / ul, head = Math.min(3, ul * 0.4);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);             // shaft
    ctx.moveTo(ex, ey); ctx.lineTo(ex - head * (nx * 0.87 - ny * 0.5), ey - head * (ny * 0.87 + nx * 0.5));
    ctx.moveTo(ex, ey); ctx.lineTo(ex - head * (nx * 0.87 + ny * 0.5), ey - head * (ny * 0.87 - nx * 0.5));
  };
  // pale halo first so the dark arrow still pops on dark/shadowed turf
  ctx.strokeStyle = "rgba(255,250,235,0.55)";
  ctx.lineWidth = 1.9;
  path(); ctx.stroke();
  ctx.strokeStyle = "rgba(20,20,20,0.7)";
  ctx.lineWidth = 0.7;                                // fixed px, zoom-independent
  path(); ctx.stroke();
}
// Build (once, cached) a small hillshade raster for a green. Pixel -> world is the
// axis-aligned affine g.relief.m; drawn later through the view transform (bilinear)
// so it's smooth and rotates with the camera. Flat areas are transparent — only
// undulation/tilt shows as soft light & shadow.
function buildGreenRelief(g) {
  const bb = polyBBox(g.poly);
  const w = bb.maxx - bb.minx, h = bb.maxy - bb.miny, long = Math.max(w, h) || 1;
  const RMAX = 96, scale = RMAX / long;
  const W = Math.max(8, Math.round(w * scale)), H = Math.max(8, Math.round(h * scale));
  const sx = w / W, sy = h / H, gmax = g.gmax || 1e-6, EX = TUNE.reliefExag;
  let lx = -0.55, ly = -0.55, lz = 0.63;              // light from NW, up
  const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const cg = c.getContext("2d"), im = cg.createImageData(W, H), D = im.data;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const X = bb.minx + (i + 0.5) * sx, Y = bb.miny + (j + 0.5) * sy;
    const gr = g.grad(X, Y), t = Math.min(1, Math.hypot(gr.x, gr.y) / gmax);
    let nx = -gr.x * EX, ny = -gr.y * EX, nz = 1;
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const d = Math.max(-1, Math.min(1, (nx * lx + ny * ly + nz * lz) - lz)); // vs flat
    const ra = Math.min(0.9, Math.abs(d) * TUNE.reliefShade);  // highlight/shadow alpha
    const rv = d >= 0 ? 255 : 0;                                // white up-light / black shadow
    const ta = Math.min(0.8, t * TUNE.reliefTint);             // faint warm tint on steep
    const oa = ra + ta * (1 - ra), k = oa > 0 ? 1 / oa : 0;    // relief OVER tint
    const o = (j * W + i) * 4;
    D[o]     = (rv * ra + 210 * ta * (1 - ra)) * k;
    D[o + 1] = (rv * ra + 140 * ta * (1 - ra)) * k;
    D[o + 2] = (rv * ra +  60 * ta * (1 - ra)) * k;
    D[o + 3] = oa * 255;
  }
  cg.putImageData(im, 0, 0);
  g.relief = { canvas: c, m: [sx, 0, bb.minx, 0, sy, bb.miny] };
}
// Thin fall-line arrows over a green (cell-center sampled so they land inside the oval).
function drawGreenArrows(g) {
  const bb = polyBBox(g.poly), AS = 1.7;   // arrow spacing (world units) — dense, precise grid
  const ax = Math.max(1, Math.round((bb.maxx - bb.minx) / AS));
  const ay = Math.max(1, Math.round((bb.maxy - bb.miny) / AS));
  const adx = (bb.maxx - bb.minx) / ax, ady = (bb.maxy - bb.miny) / ay;
  for (let j = 0; j < ay; j++) for (let i = 0; i < ax; i++) {
    const px = bb.minx + (i + 0.5) * adx, py = bb.miny + (j + 0.5) * ady;
    if (!pointInPoly(px, py, g.poly)) continue;
    const gr = g.grad(px, py), t = Math.min(1, Math.hypot(gr.x, gr.y) / (g.gmax || 1e-6));
    if (t < 0.08) continue;
    drawFallArrow(px, py, gr, t);
  }
}
// --- Flow dots: particles drifting downhill along the green's gradient ------
// Advected per-frame (no dt — matches the rest of the codebase); dots live in
// world coords so they rotate/zoom with the camera like the burst particles.
function greenArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return Math.abs(a) / 2;
}
function spawnFlowDot(g, bb) {
  for (let n = 0; n < 8; n++) {   // rejection-sample inside the polygon
    const x = bb.minx + Math.random() * (bb.maxx - bb.minx);
    const y = bb.miny + Math.random() * (bb.maxy - bb.miny);
    if (pointInPoly(x, y, g.poly))
      return { x, y, vx: 0, vy: 0, t: 0, age: 0, ttl: TUNE.flowTTLMin + Math.random() * (TUNE.flowTTLMax - TUNE.flowTTLMin) };
  }
  return null;
}
function updateFlowDots(g) {
  if (!g._flow) g._flow = { dots: [], area: greenArea(g.poly), bb: polyBBox(g.poly) };
  const f = g._flow;
  const target = Math.min(TUNE.flowMaxDots, Math.round(f.area * TUNE.flowDensity));
  // trickle-spawn toward target (avoids a pop-in burst on first frame)
  for (let n = 0; n < 6 && f.dots.length < target; n++) { const d = spawnFlowDot(g, f.bb); if (d) f.dots.push(d); }
  const gmax = g.gmax || 1e-6;
  for (let i = f.dots.length - 1; i >= 0; i--) {
    const d = f.dots[i];
    const gr = g.grad(d.x, d.y), gm = Math.hypot(gr.x, gr.y) || 1e-6;
    d.t = Math.min(1, gm / gmax);                       // steepness 0..1 (drives speed + alpha)
    const sp = TUNE.flowSpeed * (TUNE.flowMinFrac + (1 - TUNE.flowMinFrac) * d.t);
    d.vx = -gr.x / gm * sp; d.vy = -gr.y / gm * sp;     // unit downhill * speed
    d.x += d.vx; d.y += d.vy; d.age++;
    if (d.age >= d.ttl || !pointInPoly(d.x, d.y, g.poly)) f.dots.splice(i, 1);
  }
}
function flowDotAlpha(d) {
  const u = d.age / d.ttl;                              // fade in 0..0.15, out 0.7..1
  const fade = Math.min(1, u / 0.15, (1 - u) / 0.3);
  return fade * TUNE.flowAlpha * (0.55 + 0.45 * d.t);
}
// Dark halo + warm-cream core so a streak reads against turf of ANY shade —
// a single flat color (esp. green) disappears on greens close to that hue.
function strokeFlowSeg(x1, y1, x2, y2, a) {
  ctx.strokeStyle = `rgba(0,0,0,${(a * 0.4).toFixed(3)})`;
  ctx.lineWidth = 3.6;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = `rgba(255,244,200,${a.toFixed(3)})`;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
function drawFlowDots(g, fade = 1) {
  if (!g._flow || fade <= 0) return;
  ctx.lineCap = "round";
  for (const d of g._flow.dots) {
    // streak from pos back along velocity: direction reads even in a still frame
    strokeFlowSeg(wx(d.x, d.y), wyg(d.x, d.y),
      wx(d.x - d.vx * TUNE.flowTrail, d.y - d.vy * TUNE.flowTrail),
      wyg(d.x - d.vx * TUNE.flowTrail, d.y - d.vy * TUNE.flowTrail),
      flowDotAlpha(d) * fade);
  }
}
// Draw a green's shaded relief (clipped, through the view transform) at `intensity`,
// optionally with fall-line arrows. Mirrors drawAerial's view∘m compose.
function drawGreenRelief(g, intensity, showArrows) {
  if (!g.relief) buildGreenRelief(g);
  const m = g.relief.m, dpr = window.devicePixelRatio || 1;
  // Raster blit needs an affine. Under the Apple pinhole (view.appleProj),
  // linearize the projection about the green centroid — agrees with it there
  // and in its first derivatives, which at green scale is within a pixel or
  // two, so the hillshade stays a single drawImage. (The clip below goes
  // through tracePoly/wx/wy, so its outline is exactly perspective.)
  let va = view.a, vb = view.b, vc = view.c, vd = view.d, ve = view.e, vf = view.f;
  if (view.appleProj) {
    const P = view.appleProj;
    let cx = 0, cy = 0;
    for (const p of g.poly) { cx += p.x; cy += p.y; }
    cx /= g.poly.length; cy /= g.poly.length;
    const zc = _apGroundZ(P, cx, cy);   // drape the linearization on the terrain too
    const h = 0.5, q0 = appleProjPt(P, cx, cy, zc);
    const qx = appleProjPt(P, cx + h, cy, zc), qy = appleProjPt(P, cx, cy + h, zc);
    va = (qx.x - q0.x) / h; vd = (qx.y - q0.y) / h;
    vb = (qy.x - q0.x) / h; ve = (qy.y - q0.y) / h;
    vc = q0.x - va * cx - vb * cy; vf = q0.y - vd * cx - ve * cy;
  }
  const A = va * m[0] + vb * m[3], C = va * m[1] + vb * m[4], E = va * m[2] + vb * m[5] + vc;
  const B = vd * m[0] + ve * m[3], Dd = vd * m[1] + ve * m[4], F = vd * m[2] + ve * m[5] + vf;
  ctx.save();
  tracePoly(g.poly); ctx.clip();                      // clip set in device space, survives setTransform
  ctx.setTransform(dpr * A, dpr * B, dpr * C, dpr * Dd, dpr * E, dpr * F);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = intensity;
  ctx.drawImage(g.relief.canvas, 0, 0);
  ctx.restore();
  if (showArrows) drawGreenArrows(g);
}
// The green(s) currently relevant: the one the ball sits on + the one holding the pin.
// Front/middle/back of a green as seen from the ball: cast the ball->green-center
// ray and take its first/last crossings of the green boundary. Distances are in
// world units (multiply by YARDS_PER_UNIT for yards). Null if degenerate.
function greenFMB(green) {
  const b = state.ball, poly = green.poly;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= poly.length; cy /= poly.length;
  const len = Math.hypot(cx - b.x, cy - b.y);
  if (len < 1e-6) return null;
  const dx = (cx - b.x) / len, dy = (cy - b.y) / len;
  let tMin = Infinity, tMax = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    // ray b + t·d vs edge poly[j] + s·e
    const ex = poly[i].x - poly[j].x, ey = poly[i].y - poly[j].y;
    const cross = dx * ey - dy * ex;
    if (Math.abs(cross) < 1e-9) continue;
    const apx = poly[j].x - b.x, apy = poly[j].y - b.y;
    const t = (apx * ey - apy * ex) / cross;
    const s = (apx * dy - apy * dx) / cross;
    if (s < 0 || s > 1 || t <= 0) continue;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  if (!isFinite(tMin) || tMax <= tMin) return null;
  return {
    front: { x: b.x + dx * tMin, y: b.y + dy * tMin, d: tMin },
    back:  { x: b.x + dx * tMax, y: b.y + dy * tMax, d: tMax },
    mid:   { d: (tMin + tMax) / 2 },
  };
}

function greensInPlay() {
  const greens = HOLE._greens || [], out = [];
  const add = (p) => { for (const g of greens) { if (!out.includes(g) && pointInPoly(p.x, p.y, g.poly)) { out.push(g); return; } } };
  add(state.ball); add(HOLE.holePos);
  return out;
}

// --- 3D green inspect view ---------------------------------------------------
// Full-screen overlay: the green rendered as a tilted 3D surface (manual
// axonometric projection, painter's algorithm — pure canvas 2D, no WebGL).
// Drag rotates (yaw), vertical drag / pinch / scroll tilts, tap closes. The
// mesh is baked once per open; per-frame work is projection + quad fills.
function openGreenView() {
  const gs = greensInPlay();
  if (!gs.length || !canSwing()) return;
  const g = gs[0];   // ball's green if on one, else the pin's
  // yaw seeds from the camera angle so the inspect view opens oriented the way
  // the player was just looking; the main camera is irrelevant while open.
  greenView = { g, mesh: buildGreenViewMesh(g), yaw: view.angle, tilt: TUNE.gvTilt, drag: null };
  document.body.classList.add("gv-open");
}
function closeGreenView() {
  greenView = null;
  document.body.classList.remove("gv-open");
}

function buildGreenViewMesh(g) {
  const bb = polyBBox(g.poly);
  const R = Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny) / 2 * 1.02 || 1;
  const hMid = (g.hmin + g.hmax) / 2, hHalf = Math.max((g.hmax - g.hmin) / 2, 1e-6);
  const zOf = (x, y) => (g.h(x, y) - hMid) / hHalf * R * TUNE.gvHeight; // world-unit height
  const N = TUNE.gvGrid, M = N + 1;
  const W = bb.maxx - bb.minx || 1, H = bb.maxy - bb.miny || 1;
  // grid corners: world-relative coords + height
  const px = new Float32Array(M * M), py = new Float32Array(M * M), pz = new Float32Array(M * M);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const X = bb.minx + W * i / N, Y = bb.miny + H * j / N, k = j * M + i;
    px[k] = X - bb.cx; py[k] = Y - bb.cy; pz[k] = zOf(X, Y);
  }
  // cells inside the polygon, color baked at the cell center: hillshade (same
  // light + normal math as buildGreenRelief) x height tint (high = light,
  // low = dark) so both slope AND elevation read at a glance.
  let lx = -0.55, ly = -0.55, lz = 0.63;
  const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  const cells = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = bb.minx + W * i / N, y0 = bb.miny + H * j / N;
    const x1 = x0 + W / N, y1 = y0 + H / N;
    const ccx = x0 + W / N / 2, ccy = y0 + H / N / 2;
    if (!pointInPoly(ccx, ccy, g.poly)) continue;
    // boundary quads (a corner pokes past the rim) get clipped to the rim path
    // at draw time, so the silhouette follows the smooth green outline
    const edge = !pointInPoly(x0, y0, g.poly) || !pointInPoly(x1, y0, g.poly)
              || !pointInPoly(x1, y1, g.poly) || !pointInPoly(x0, y1, g.poly);
    const gr = g.grad(ccx, ccy);
    let nx = -gr.x * TUNE.reliefExag, ny = -gr.y * TUNE.reliefExag, nz = 1;
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const d = Math.max(-1, Math.min(1, nx * lx + ny * ly + nz * lz - lz));
    const hn = (g.h(ccx, ccy) - g.hmin) / Math.max(g.hmax - g.hmin, 1e-6); // 0 low .. 1 high
    const shade = Math.max(0.5, Math.min(1.35, (0.9 + d * 1.8) * (0.72 + 0.33 * hn)));
    cells.push({
      i0: j * M + i, rx: ccx - bb.cx, ry: ccy - bb.cy, edge,
      color: `rgb(${Math.min(255, 96 * shade) | 0},${Math.min(255, 150 * shade) | 0},${Math.min(255, 102 * shade) | 0})`,
    });
  }
  const rel = (p) => ({ rx: p.x - bb.cx, ry: p.y - bb.cy, z: zOf(p.x, p.y) });
  const contours = (g.contours || []).map((c) => ({ closed: c.closed, pts: c.pts.map(rel) }));
  const rim = g.poly.map(rel);
  let zMin = Infinity;
  for (let k = 0; k < pz.length; k++) if (pz[k] < zMin) zMin = pz[k];
  const pin = pointInPoly(HOLE.holePos.x, HOLE.holePos.y, g.poly) ? rel(HOLE.holePos) : null;
  const ball = pointInPoly(state.ball.x, state.ball.y, g.poly) ? rel(state.ball) : null;
  return { N, M, R, cx: bb.cx, cy: bb.cy, px, py, pz, cells, contours, rim, zMin, pin, ball, zOf };
}

// Projection: yaw about the green center, then tilt about the screen-x axis.
//   u = rx·cosY − ry·sinY            (screen-horizontal)
//   v = rx·sinY + ry·cosY            (depth; +v = nearer the viewer)
//   sx = X0 + k·u,  sy = Y0 + k·v·cosT − k·z·sinT
// Painter's order: draw cells ascending v (far → near).
let _gvSX = null, _gvSY = null;   // per-frame projected corner scratch
// Shared 3D green painter — scrim, flat shadow slab, side wall, painter-sorted
// surface quads, contours, optional flow dots, cup + flagstick. Used by the
// inspect view (drawGreenView) and the landing cinematic (drawCine). Returns the
// projector + view numbers so callers can draw their own markers in the same space.
function paintGreen3D(g, m, yaw, tilt, kMul, opts) {
  const cssW = window.innerWidth, cssH = window.innerHeight;
  const rsv = hudReserve();
  ctx.fillStyle = "rgba(8,18,10,0.88)";                 // scrim over the live course
  ctx.fillRect(0, 0, cssW, cssH);
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
  const panel = Math.min(cssW - 32, cssH - rsv.top - rsv.bot - 90);
  const k = panel / (2 * m.R * 1.12) * (kMul || 1);
  const X0 = cssW / 2, Y0 = (rsv.top + (cssH - rsv.bot)) / 2 + panel * 0.04;
  const proj = (rx, ry, z) => ({
    x: X0 + k * (rx * cosY - ry * sinY),
    y: Y0 + k * (rx * sinY + ry * cosY) * cosT - k * z * sinT,
  });
  // project all grid corners once
  const n = m.px.length;
  if (!_gvSX || _gvSX.length !== n) { _gvSX = new Float32Array(n); _gvSY = new Float32Array(n); }
  for (let i = 0; i < n; i++) {
    _gvSX[i] = X0 + k * (m.px[i] * cosY - m.py[i] * sinY);
    _gvSY[i] = Y0 + k * (m.px[i] * sinY + m.py[i] * cosY) * cosT - k * m.pz[i] * sinT;
  }
  // Flat-ground shadow: the slab under the surface sits at ONE constant height
  // (zB), so however the view is tilted it always reads as level ground — the
  // varying gap between it and the surface edge is the honest steepness cue.
  const zB = m.zMin - 0.06 * m.R;
  ctx.fillStyle = "#12301a";
  ctx.beginPath();
  m.rim.forEach((p, i) => {
    const q = proj(p.rx, p.ry, zB);
    i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  });
  ctx.closePath(); ctx.fill();
  // side wall: surface rim down to the flat slab (band between the two loops)
  ctx.fillStyle = "#1a3f24";
  ctx.beginPath();
  m.rim.forEach((p, i) => {
    const q = proj(p.rx, p.ry, p.z);
    i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  });
  for (let i = m.rim.length - 1; i >= 0; i--) {
    const p = m.rim[i], q = proj(p.rx, p.ry, zB);
    ctx.lineTo(q.x, q.y);
  }
  ctx.closePath(); ctx.fill();
  // surface footprint (rim draped at surface height) in base turf: fills any
  // sliver between clipped boundary quads; also the clip path for edge quads
  const rimPath = new Path2D();
  m.rim.forEach((p, i) => {
    const q = proj(p.rx, p.ry, p.z);
    i ? rimPath.lineTo(q.x, q.y) : rimPath.moveTo(q.x, q.y);
  });
  rimPath.closePath();
  ctx.fillStyle = "rgb(80,126,86)";
  ctx.fill(rimPath);
  // surface quads, painter-sorted back to front
  const order = m.cells.map((_, i) => i);
  const depth = m.cells.map((c) => c.rx * sinY + c.ry * cosY);
  order.sort((a, b) => depth[a] - depth[b]);
  ctx.lineWidth = 1;
  for (const oi of order) {
    const c = m.cells[oi], i0 = c.i0, i1 = i0 + 1, i2 = i0 + m.M + 1, i3 = i0 + m.M;
    if (c.edge) { ctx.save(); ctx.clip(rimPath); }
    ctx.fillStyle = c.color;
    ctx.strokeStyle = c.color;      // stroke same color: kills antialias seams between quads
    ctx.beginPath();
    ctx.moveTo(_gvSX[i0], _gvSY[i0]);
    ctx.lineTo(_gvSX[i1], _gvSY[i1]);
    ctx.lineTo(_gvSX[i2], _gvSY[i2]);
    ctx.lineTo(_gvSX[i3], _gvSY[i3]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (c.edge) ctx.restore();
  }
  // contour lines draped on the surface
  ctx.strokeStyle = "rgba(20,50,25,0.45)";
  ctx.lineWidth = 1.2;
  for (const c of m.contours) {
    ctx.beginPath();
    c.pts.forEach((p, i) => {
      const q = proj(p.rx, p.ry, p.z);
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    });
    if (c.closed) ctx.closePath();
    ctx.stroke();
  }
  // flow dots drift downhill ON the tilted surface — the strongest break cue.
  // (The top-down pass skips advecting this green while the inspect is open.)
  if (!opts || !opts.noFlow) {
    updateFlowDots(g);
    if (g._flow) {
      ctx.lineCap = "round";
      for (const d of g._flow.dots) {
        const a = proj(d.x - m.cx, d.y - m.cy, m.zOf(d.x, d.y));
        const bx = d.x - d.vx * TUNE.flowTrail, by = d.y - d.vy * TUNE.flowTrail;
        const b = proj(bx - m.cx, by - m.cy, m.zOf(bx, by));
        strokeFlowSeg(a.x, a.y, b.x, b.y, flowDotAlpha(d));
      }
    }
  }
  if (!opts || !opts.noPin) drawCupFlag3D(proj, m, cosT);
  return { proj, cosY, sinY, cosT, sinT, k, X0, Y0, panel, cssW, cssH, rsv };
}

// cup + flagstick (drawn after the mesh — must never be hidden)
function drawCupFlag3D(proj, m, cosT) {
  if (!m.pin) return;
  const q = proj(m.pin.rx, m.pin.ry, m.pin.z);
  ctx.beginPath(); ctx.ellipse(q.x, q.y, 5, Math.max(1.5, 5 * cosT), 0, 0, Math.PI * 2);
  ctx.fillStyle = "#101010"; ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.strokeStyle = "#f4f1e8"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, q.y - 44); ctx.stroke();
  ctx.fillStyle = "#c8442c";
  ctx.beginPath();
  ctx.moveTo(q.x, q.y - 44); ctx.lineTo(q.x + 16, q.y - 38.5); ctx.lineTo(q.x, q.y - 33);
  ctx.closePath(); ctx.fill();
}

function drawGreenView() {
  if (!greenView) return;
  if (mode !== "course") { closeGreenView(); return; }
  const gv = greenView, m = gv.mesh;
  const s = paintGreen3D(gv.g, m, gv.yaw, gv.tilt, 1, null);
  const { proj, cssW, cssH, rsv, panel, Y0 } = s;
  // ball marker (only if the ball is on this green)
  if (m.ball) {
    const q = proj(m.ball.rx, m.ball.ry, m.ball.z);
    ctx.beginPath(); ctx.ellipse(q.x, q.y + 2, 4.5, 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill();
    ctx.beginPath(); ctx.arc(q.x, q.y - 2, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1; ctx.stroke();
  }
  // chrome: title, hint, close affordance (tap anywhere closes; ✕ is visual)
  drawLabel(cssW / 2, Math.max(rsv.top + 18, Y0 - panel / 2 - 26), "READING GREEN", "#f4f1e8");
  drawLabel(cssW / 2, cssH - rsv.bot - 16,
    IS_DESKTOP ? "drag to rotate · scroll to tilt · click to close"
               : "drag to rotate · pinch to tilt · tap to close",
    "rgba(244,241,232,0.85)");
  const cxX = cssW - safeInset.r - 30, cxY = safeInset.t + 30;
  ctx.beginPath(); ctx.arc(cxX, cxY, 16, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cxX - 5, cxY - 5); ctx.lineTo(cxX + 5, cxY + 5);
  ctx.moveTo(cxX + 5, cxY - 5); ctx.lineTo(cxX - 5, cxY + 5);
  ctx.stroke();
}

// --- Cinematic 3D landing --------------------------------------------------
// Auto-cut to the pin's green in 3D while a great approach descends onto it
// (armed by maybeArmCine at launch). Same mesh + projection as the inspect
// view, but the camera is scripted (slow push-in + gentle orbit) and the BALL
// IS LIVE — the real physics keeps running underneath; this only renders it.
function openCine() {
  if (greenView) closeGreenView();
  cine = {
    g: cinePending.g, mesh: cinePending.mesh,
    t0: performance.now(),
    yaw0: view.angle,        // same heading the player was just watching — a clean cut
    tilt: TUNE.gvTilt,
    restT: 0,                // set when the ball settles; closes after cineHoldMs
  };
  cinePending = null;
  document.body.classList.add("gv-open");
}
function closeCine() {
  cine = null;
  cinePending = null;
  document.body.classList.remove("gv-open");
}
// Lifecycle (called from loop): cut in once the armed shot is on its way down;
// close a beat after the ball settles. Hole-outs close via showResult instead.
function tickCine() {
  if (cinePending) {
    if (!state.moving) { cinePending = null; return; } // shot over before the cut (safety)
    if (!state.airborne || !state.flight || state.flight.d >= cinePending.openAtD) openCine();
    return;
  }
  if (!cine) return;
  if (mode !== "course") { closeCine(); return; }
  if (!state.moving && !state.inHole) {
    if (!cine.restT) cine.restT = performance.now();
    else if (performance.now() - cine.restT >= TUNE.cineHoldMs) closeCine();
  }
}
function drawCine() {
  if (!cine) return;
  if (mode !== "course") { closeCine(); return; }
  const m = cine.mesh, b = state.ball;
  const t = (performance.now() - cine.t0) / 1000;
  // slow push-in (eased) + gentle orbit — scripted, no user input
  const zp = Math.min(1, (performance.now() - cine.t0) / TUNE.cineZoomMs);
  const kMul = 1 + (TUNE.cineZoomIn - 1) * (1 - Math.pow(1 - zp, 3));
  const yaw = cine.yaw0 + TUNE.cineYawDrift * t;
  const s = paintGreen3D(cine.g, m, yaw, cine.tilt, kMul, { noFlow: true, noPin: true });
  const { proj, cosT } = s;
  // live ball: real world position + flight height, in the mesh's space. Surface
  // z is the exaggerated relief (zOf); the airborne height b.z is true world
  // units — huge next to the relief, which is the point: the ball drops in from
  // high above the surface.
  const rx = b.x - m.cx, ry = b.y - m.cy;
  const groundZ = m.zOf(b.x, b.y);
  let drawBallFn = null;
  if (!state.inHole) {
    const q0 = proj(rx, ry, groundZ);                          // ground shadow
    const q = proj(rx, ry, groundZ + b.z * TUNE.cineBallZ);    // ball
    const r = 4.5 + Math.min(3, b.z * 0.25);                   // a touch bigger up high
    drawBallFn = () => {
      ctx.beginPath(); ctx.ellipse(q0.x, q0.y + 2, 4.5, Math.max(1.5, 4.5 * cosT), 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill();
      ctx.beginPath(); ctx.arc(q.x, q.y - 2, r, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1; ctx.stroke();
    };
  } else if (holeDrop) {
    // holed while the cinematic runs: sink the ball into the cup on the mesh
    const p = Math.min(1, (performance.now() - holeDrop.t0) / HOLE_DROP_MS);
    const q = proj(m.pin ? m.pin.rx : rx, m.pin ? m.pin.ry : ry, m.pin ? m.pin.z : groundZ);
    drawBallFn = () => {
      ctx.globalAlpha = 1 - p;
      ctx.beginPath(); ctx.arc(q.x, q.y - 2 * (1 - p), 4.5 * (1 - 0.6 * p), 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.globalAlpha = 1;
    };
  }
  // ball vs flagstick: painter's order by depth so the ball can pass behind the pin
  const ballDepth = rx * s.sinY + ry * s.cosY;
  const pinDepth = m.pin ? m.pin.rx * s.sinY + m.pin.ry * s.cosY : -Infinity;
  if (drawBallFn && ballDepth <= pinDepth) {
    drawBallFn();
    drawCupFlag3D(proj, m, cosT);
  } else {
    drawCupFlag3D(proj, m, cosT);
    if (drawBallFn) drawBallFn();
  }
  drawLabel(s.cssW / 2, s.cssH - s.rsv.bot - 16, "tap to skip", "rgba(244,241,232,0.6)");
}

// Inspect-view pointer handling: 1-finger drag = yaw + tilt, pinch = tilt,
// tap = close. Tilting is safe to allow because the flat-ground shadow slab
// under the surface is the steepness reference, not the viewing angle.
function gvClamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function gvPointerStart(e) {
  if (e.touches && e.touches.length >= 2) {   // pinch -> tilt
    const t0 = e.touches[0], t1 = e.touches[1];
    greenView.drag = {
      pinch: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
      tilt0: greenView.tilt, moved: true,
    };
    return;
  }
  const p = pointerPos(e);
  greenView.drag = { x: p.x, y: p.y, yaw0: greenView.yaw, tilt0: greenView.tilt, moved: false, t0: performance.now() };
}
function gvPointerMove(e) {
  const d = greenView.drag;
  if (!d) return;
  if (d.pinch != null && e.touches && e.touches.length >= 2) {
    const t0 = e.touches[0], t1 = e.touches[1];
    const nd = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    greenView.tilt = gvClamp(d.tilt0 + (d.pinch - nd) * 0.004, TUNE.gvTiltMin, TUNE.gvTiltMax);
    return;
  }
  const p = pointerPos(e);
  if (Math.hypot(p.x - d.x, p.y - d.y) > 6) d.moved = true;
  greenView.yaw = d.yaw0 + (p.x - d.x) * TUNE.gvYawRate;
  greenView.tilt = gvClamp(d.tilt0 + (p.y - d.y) * TUNE.gvTiltRate, TUNE.gvTiltMin, TUNE.gvTiltMax);
}
function gvPointerEnd() {
  const d = greenView.drag;
  greenView.drag = null;
  if (d && !d.moved && d.pinch == null && performance.now() - d.t0 < 450) closeGreenView(); // tap = close
}

// Stylized vector rendering (used when no aerial, e.g. offline / St Andrews).
function drawOOBOverlay(s) {
  if (!showOOB) return;
  // Mask-driven: draw the baked OOB/woods red raster through the aerial transform.
  const m = HOLE && HOLE._mask;
  if (m && m.oob) {
    const t = m.toWorld, dpr = window.devicePixelRatio || 1;
    const A = view.a * t[0] + view.b * t[3], C = view.a * t[1] + view.b * t[4];
    const E = view.a * t[2] + view.b * t[5] + view.c;
    const B = view.d * t[0] + view.e * t[3], D = view.d * t[1] + view.e * t[4];
    const F = view.d * t[2] + view.e * t[5] + view.f;
    ctx.save();
    ctx.setTransform(dpr * A, dpr * B, dpr * C, dpr * D, dpr * E, dpr * F);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(m.oob, 0, 0);
    ctx.restore();
    return;
  }
  // Fallback (no mask): OSM woods polygons.
  if (!s.woods || !s.woods.length) return;
  ctx.save();
  ctx.globalAlpha = 0.16;
  fillPolys(s.woods, "#cc1f1f");
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(210,40,40,0.4)";
  ctx.lineWidth = 1.5;
  for (const poly of s.woods) { tracePoly(poly); ctx.stroke(); }
  ctx.restore();
}

function drawVectorSurfaces() {
  const cssW = window.innerWidth, cssH = window.innerHeight + 2 * _capPad, s = HOLE.surfaces;
  const bg = ctx.createLinearGradient(0, 0, 0, cssH);
  bg.addColorStop(0, "#236425");
  bg.addColorStop(1, "#2c7e2f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.globalAlpha = 0.5;
  stripes("#2a7a2c", "#266e28", 9, "y");
  ctx.globalAlpha = 1;

  fillPolys(s.grass, "#3a9440");                 // mown turf between holes
  fillPolys(s.rough, "#2c6e30");                 // mapped rough — a touch darker than base

  for (const poly of s.fairway || []) withClip(poly, () => stripes("#4eb053", "#46a44b", 7, "y"));
  ctx.strokeStyle = "rgba(28,66,30,0.45)"; ctx.lineWidth = 1.5;
  for (const poly of s.fairway || []) { tracePoly(poly); ctx.stroke(); }

  for (const poly of s.tee || []) withClip(poly, () => stripes("#5cbf61", "#54b659", 3, "x"));

  for (const poly of s.bunker || []) {
    const bb = polyBBox(poly);
    withClip(poly, () => {
      const scx = wx(bb.cx, bb.cy), scy = wy(bb.cx, bb.cy);
      const rad = ws(Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny) / 2) || 1;
      const rg = ctx.createRadialGradient(scx, scy, rad * 0.1, scx, scy, rad * 1.05);
      rg.addColorStop(0, "#f1e6c4");
      rg.addColorStop(1, "#d4be8a");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, cssW, cssH);
    });
    tracePoly(poly);
    ctx.strokeStyle = "rgba(120,100,58,0.85)"; ctx.lineWidth = 1.5; ctx.stroke();
  }

  fillPolys(s.woods, "#2f5d34");                  // tree stands
  drawDEMShade();                                  // tilted only: DEM light/shadow
  if (showOOB) drawOOBOverlay(s);                  // red OOB tint on top
  ctx.strokeStyle = "rgba(225,220,205,0.8)";       // cart paths
  ctx.lineWidth = Math.max(ws(0.8), 1);
  for (const poly of s.cartpath || []) strokePolyline(poly);

  drawGreen(false);

  for (const poly of s.water || []) {
    const r = visibleRect();
    withClip(poly, () => {
      const lg = ctx.createLinearGradient(0, wy(0, r.y), 0, wy(0, r.y + r.h));
      lg.addColorStop(0, "#34b3f1");
      lg.addColorStop(1, "#1666c1");
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, cssW, cssH);
    });
    tracePoly(poly);
    ctx.strokeStyle = "rgba(12,64,150,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
  }
}

// --- True-3D tilted ground: the flat ground render is captured (with vertical
// pad) into an offscreen, then re-drawn in vertical column bands displaced by
// the DEM — cheap axis-aligned displacement mapping. Photo, tints, contours,
// OOB, relief all warp together because they're all in the capture.
let _capPad = 0;      // css px of extra viewport above+below while capturing
let _warpPad = 0;     // this frame's pad (0 = warp off)
let _groundC = null;  // cached offscreen canvas
let _mainCtx = null, _savedViewF = 0;
// Warped-ground cache: the camera is parked most of the time, so the capture +
// band warp only re-runs when something in the ground actually changed; parked
// frames cost one full-screen blit. Animated bits (flow dots, ball, flag) draw
// above the cache.
let _warpCache = null; // { sig, canvas, g }
let _warpMotion = false; // camera moving: coarser bands / fewer wall layers / no grain
let _sigStreak = 0;      // consecutive rebuild frames (2+ = real motion, not a one-off)
// Angle-bucket cache: pre-baked ground rasters at discrete camera angles, kept
// warm by idle prebaking (maybePrebakeBucket) and cross-dissolved while the
// camera sweeps (arrow-key aiming) so a sustained aim-hold doesn't force a
// full recapture every frame. Keyed by baseWarpKey()+"#"+bucketIndex ->
// {canvas, g, baseKey, bucketIndex, scale, ts}. Each entry costs the same as
// _warpCache.canvas (full viewport-sized offscreen) — bounded + LRU-evicted.
let _bucketCache = new Map();
function evictBucketsIfOverCap() {
  const cap = IS_DESKTOP ? TUNE.tBucketMax : Math.ceil(TUNE.tBucketMax / 2);
  while (_bucketCache.size > cap) {
    let oldestKey = null, oldestTs = Infinity;
    for (const [k, v] of _bucketCache) if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    _bucketCache.delete(oldestKey);
  }
}
// Ball only affects the baked ground via its canopy punch-out — keep it out of
// the sig on open ground so putts/rolls never churn the cache.
function ballNearCanopy() {
  const b = state.ball;
  if (!b || !HOLE._mask) return false;
  const r = TUNE.punchBallR;
  for (const [ox, oy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r],
                          [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) {
    if (canopyCellAt(b.x + ox, b.y + oy)) return true;
  }
  return false;
}
// Everything the cache key needs EXCEPT the rotation-derived matrix terms
// (view.a/b/c/d/e/f) — i.e. the part that's angle-invariant given a fixed
// tilt/focus/scale. Shared by the exact single-slot cache (warpSig) and the
// angle-bucket cache (which swaps in a discrete-angle matrix per bucket).
// NOTE: no greens-in-play term. Relief now bakes for ALL visible greens (see
// draw()), so the baked ground is shot-independent — a settled shot on/near a
// green no longer invalidates the ground+tree cache. ballTerm only changes in
// the woods (canopy punch follow), not on green/fairway. It's computed in
// WORLD space (not wx/wyg screen space) so it stays angle-invariant too —
// otherwise it would churn on every frame of an aim sweep just like the
// matrix terms it's meant to be independent of.
function baseWarpKey(cssW, cssH) {
  const q = (v) => Math.round(v * 8) / 8; // 1/8px quantum ends the ease-tail churn
  const b = state.ball;
  const ballTerm = ballNearCanopy()
    ? Math.round(b.x / 2) + "." + Math.round(b.y / 2) : "-";
  return q(view.kz * 100) + "," + q(view.zFocus * 50) + "," +
         HOLE.num + "," + (showOOB ? 1 : 0) + (showSlope ? 1 : 0) + (breakArrows ? 1 : 0) +
         (HOLE._imgReady ? 1 : 0) + (HOLE._mask && HOLE._mask.lab ? 1 : 0) + "," +
         cssW + "x" + cssH + "," + _warpPad + "," + ballTerm;
}
function warpSig(cssW, cssH) {
  const q = (v) => Math.round(v * 8) / 8; // 1/8px quantum ends the ease-tail churn
  return q(view.a) + "," + q(view.b) + "," + q(view.c) + "," + q(view.d) + "," +
         q(view.e) + "," + q(view.f) + "," + baseWarpKey(cssW, cssH);
}
// Angle-bucket helpers: discretize camera.angle into TUNE.tAngleBuckets steps
// around the full circle so the warp cache can pre-bake a handful of angles
// and cross-dissolve between the two nearest while the camera is sweeping
// (arrow-key aiming), instead of a full recapture every frame.
function angleBucketIndex(angle) {
  const N = TUNE.tAngleBuckets, step = (Math.PI * 2) / N;
  const raw = angle / step;
  return ((Math.floor(raw) % N) + N) % N; // wraps negative angles correctly
}
function angleBucketFrac(angle) {
  const step = (Math.PI * 2) / TUNE.tAngleBuckets;
  const raw = angle / step;
  return raw - Math.floor(raw); // 0..1 blend weight toward the next bucket
}
function bucketAngle(i) { return i * (Math.PI * 2 / TUNE.tAngleBuckets); }
// Pre-erosion canopy (woods) cell at a world point — the cells the canopy
// extrusion and standing trees are built from.
function canopyCellAt(x, y) {
  const m = HOLE && HOLE._mask;
  if (!m || !m.w2p) return false;
  const src = m.canopy || m.lab;
  const t = m.w2p;
  const px = Math.round(t[0] * x + t[1] * y + t[2]);
  const py = Math.round(t[3] * x + t[4] * y + t[5]);
  if (px < 0 || py < 0 || px >= m.w || py >= m.h) return false;
  return src[py * m.w + px] === 3;
}
// Max |lift| on screen this frame, from a coarse screen grid (+slack).
function estimateWarpPad(cssW, cssH) {
  if (!view.kz || !HOLE) return 0;  // synthetic terrainZ lifts even without a DEM
  let mx = 0;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 3; j++) {
    const p = screenToWorld(cssW * i / 4, cssH * j / 3);
    const l = Math.abs((terrainZ(p.x, p.y) - view.zFocus) * view.scale * view.kz);
    if (l > mx) mx = l;
  }
  // The coarse 5x4 grid can step over a small green bump -> pad too short ->
  // clipped green tops. Sample each visible green's own extremes explicitly.
  const gs = HOLE._greens;
  if (gs && TUNE.gUndOn) {
    for (const g of gs) {
      const p = polyBBox(g.poly);
      const pts = [[p.cx, p.cy], [p.minx, p.miny], [p.maxx, p.miny],
                   [p.minx, p.maxy], [p.maxx, p.maxy]];
      if (g.hi) pts.push([g.hi.x, g.hi.y]);
      if (g.lo) pts.push([g.lo.x, g.lo.y]);
      for (const [wxx, wyy] of pts) {
        const sx = wx(wxx, wyy), sy = wy(wxx, wyy);
        if (sx < -cssW * 0.2 || sx > cssW * 1.2 || sy < -cssH || sy > cssH * 1.2) continue;
        const l = Math.abs((terrainZ(wxx, wyy) - view.zFocus) * view.scale * view.kz);
        if (l > mx) mx = l;
      }
    }
  }
  // Canopy lifts trees ABOVE the terrain pad: forest just past the top screen
  // edge must be inside the capture or its tops clip into smear streaks. Add
  // the tallest tier's lift when woods cells sit in that band.
  const tiers = TUNE.canopyTiers;
  const canopyLift = ws(TUNE.canopyH * tiers[tiers.length - 1]) * view.kz;
  if (canopyLift >= 2 && HOLE._mask && HOLE._imgReady) {
    let hit = false;
    for (let i = 0; i <= 8 && !hit; i++) {
      for (const yy of [0, canopyLift / 2, canopyLift]) {
        const p = screenToWorld(cssW * i / 8, -yy + cssH * 0.02);
        if (canopyCellAt(p.x, p.y)) { hit = true; break; }
      }
    }
    if (hit) mx += canopyLift;
  }
  if (mx < 1) return 0;
  // Quantized: an unquantized pad changes every zoom frame, which resizes (and
  // reallocates) the full-screen capture canvas per frame and churns warpSig.
  return Math.min(TUNE.tPadMax, Math.ceil((mx + 10) / TUNE.tPadQuant) * TUNE.tPadQuant);
}
function startGroundCapture(cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(cssW * dpr), h = Math.round((cssH + 2 * _warpPad) * dpr);
  if (!_groundC || _groundC.width !== w || _groundC.height !== h) {
    _groundC = document.createElement("canvas");
    _groundC.width = w; _groundC.height = h;
  }
  _capPad = _warpPad;
  _savedViewF = view.f;
  view.f += _capPad;  // shift the scene down so the top pad band has content
  const g = _groundC.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH + 2 * _capPad);
  _mainCtx = ctx; ctx = g;  // the whole ground stack draws into the offscreen
}
// Restore the real context/view, then displace: dest band [y0,y1] samples the
// capture at [y0+l0, y1+l1] — lift pulls pixels up, bands stay contiguous.
// `target` defaults to _warpCache (today's single-slot parked cache); the
// angle-bucket cache passes its own bucket entry instead so bakeBucket() can
// reuse this whole pipeline without disturbing the live parked cache. Unlike
// the default-target path, a bucket bake does NOT blit here — the caller
// decides if/when a baked bucket is actually drawn (cross-dissolve).
function finishGroundWarp(cssW, cssH, sig, target) {
  const dpr = window.devicePixelRatio || 1;
  const pad = _capPad;
  ctx = _mainCtx; _mainCtx = null;
  view.f = _savedViewF; _capPad = 0;
  const usingDefault = target === undefined;
  if (usingDefault) target = _warpCache;
  const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
  if (!target || target.canvas.width !== w || target.canvas.height !== h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    target = { sig: null, canvas: c, g: c.getContext("2d") };
  }
  if (usingDefault) _warpCache = target;
  const g = target.g;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);
  g.imageSmoothingEnabled = true;
  if (!pad) {
    // no measurable lift (no DEM, or flat terrain in view): the capture IS the
    // frame — copy it straight into the cache, skip the band loop entirely
    g.drawImage(_groundC, 0, 0, _groundC.width, _groundC.height, 0, 0, cssW, cssH);
  } else {
  // Planar fast path: sample the lift field on a coarse grid and fit a plane
  // lift ≈ L0 + gx·x + gy·y. Zoomed near a green the field is locally planar
  // (a green spans 2-3 DEM cells), so one sheared drawImage renders the SAME
  // displacement as the bands with zero band seams — exactly where per-column
  // sampling fragments worst — and costs 1 draw instead of ~900.
  let planar = null;
  {
    const L = [];
    for (let j = 0; j <= 3; j++) for (let i = 0; i <= 4; i++) {
      const p = screenToWorld(cssW * i / 4, cssH * j / 3);
      L.push(liftAt(p.x, p.y));
    }
    const at = (i, j) => L[j * 5 + i];
    const gx = ((at(4, 0) + at(4, 3)) - (at(0, 0) + at(0, 3))) / (2 * cssW);
    const gy = ((at(0, 3) + at(4, 3)) - (at(0, 0) + at(4, 0))) / (2 * cssH);
    const c0 = (at(0, 0) + at(4, 0) + at(0, 3) + at(4, 3)) / 4 - gx * cssW / 2 - gy * cssH / 2;
    let res = 0;
    for (let j = 0; j <= 3; j++) for (let i = 0; i <= 4; i++) {
      const r = Math.abs(at(i, j) - (c0 + gx * cssW * i / 4 + gy * cssH * j / 3));
      if (r > res) res = r;
    }
    if (res <= TUNE.tPlanarTol && 1 + gy > 0.2) planar = { L0: c0, gx, gy };
  }
  if (planar) {
    // Invert y_cap = y + lift(x,y) + pad for the dest pixel:
    // y = (y_cap − pad − L0 − gx·x) / (1+gy) — one affine, seam-free.
    const { L0, gx, gy } = planar;
    const k = 1 / (1 + gy);
    g.setTransform(dpr, -dpr * gx * k, 0, dpr * k, 0, -dpr * (pad + L0) * k);
    g.drawImage(_groundC, 0, 0, _groundC.width, _groundC.height,
                0, 0, cssW, cssH + 2 * pad);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  } else {
  const mul = (IS_DESKTOP ? 1 : 1.3) * (_warpMotion ? TUNE.tMotionCoarse : 1);
  const colW = Math.max(TUNE.tWarpCol * mul, cssW / 32);
  const rowH = Math.max(TUNE.tWarpRow * mul, cssH / 28);
  for (let x = 0; x < cssW; x += colW) {
    const cw = Math.min(colW, cssW - x), cx = x + cw / 2;
    let y0 = 0;
    let p = screenToWorld(cx, 0), l0 = liftAt(p.x, p.y);
    while (y0 < cssH) {
      const y1 = Math.min(y0 + rowH, cssH);
      p = screenToWorld(cx, y1);
      const l1 = liftAt(p.x, p.y);
      // clamp, never skip: a folded band renders a thin stretched slice instead
      // of a transparent hole (the "fragmented rows" the skip used to leave)
      const sh = Math.max((y1 + l1) - (y0 + l0), 1);
      g.drawImage(_groundC,
        x * dpr, (y0 + l0 + pad) * dpr, cw * dpr, sh * dpr,
        x, y0, cw, y1 - y0);
      y0 = y1; l0 = l1;
    }
  }
  }
  }
  // trees are static under the same sig — bake them into the cache so parked
  // frames are one blit
  const real = ctx;
  ctx = g; drawTrees(); ctx = real;
  target.sig = sig;
  target.degraded = _warpMotion;
  if (usingDefault) ctx.drawImage(target.canvas, 0, 0, cssW, cssH);
  return target;
}

// Bake one angle-bucket ground raster: same capture+warp+tree pipeline as a
// live rebuild, but with `view` temporarily substituted to the bucket's
// discrete angle (and its own angle-correct scale, since camera.scale isn't
// rotation-invariant while aiming — see frameScaleForAngle). Only ever called
// from a macrotask (idle prebake, or a same-tick fill when a bucket is
// missing) that runs AFTER draw() has fully returned for the frame — it
// shares the singleton capture scratch state (_groundC/_mainCtx/_capPad/
// _savedViewF) with draw()'s own startGroundCapture/finishGroundWarp calls,
// so it must never run nested inside draw()'s call stack.
function bakeBucket(bucketIndex, baseKey, cssW, cssH) {
  const angle = bucketAngle(bucketIndex);
  const { scale } = frameScaleForAngle(angle, state.ball.x, state.ball.y);
  const savedView = Object.assign({}, view);
  const savedAABB = _viewAABB, savedPad = _warpPad;
  Object.assign(view, computeViewMatrix(angle, camera.tilt, scale, camera.focus.x, camera.focus.y, cssW, cssH));
  _warpPad = estimateWarpPad(cssW, cssH);
  computeViewAABB();
  const key = baseKey + "#" + bucketIndex;
  let entry = _bucketCache.get(key);
  if (!entry) {
    const dpr = window.devicePixelRatio || 1;
    const c = document.createElement("canvas");
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
    entry = { canvas: c, g: c.getContext("2d"), baseKey, bucketIndex, scale, ts: 0 };
  }
  startGroundCapture(cssW, cssH);
  drawGroundStack(cssW, cssH, true);
  finishGroundWarp(cssW, cssH, key, entry);
  entry.ts = performance.now();
  _bucketCache.set(key, entry);
  evictBucketsIfOverCap();
  Object.assign(view, savedView);
  _viewAABB = savedAABB; _warpPad = savedPad;
}

// --- Standing trees (tilted view) ----------------------------------------
// Tree positions come from the aerial surface mask's WOODS cells (jittered,
// hash-thinned) or, without a mask, a seeded scatter inside the OSM woods
// polygons. Built once per course; drawn as pre-rendered canopy sprites that
// rise with the tilt (lift = ws(h)·kz), painter-sorted by screen y.
// A closed, rounded-corner blob outline (jittered radius per angle, joined by
// quadratic curves through edge midpoints) traced into `g`'s current path —
// the standard "cloud/tree clump" shape, NOT a circle/ellipse. Mottling
// alone (internal gradient) still reads as a sphere once magnified because
// the OUTLINE stays perfectly round; breaking the outline itself is what
// sells "leafy" at any zoom.
function blobPath(g, cx, cy, r, jitter, n, rnd, squash) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = r * (1 - jitter / 2 + rnd() * jitter);
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * squash]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  g.beginPath();
  g.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const cur = pts[i], next = pts[(i + 1) % n], m = mid(cur, next);
    g.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
  }
  g.closePath();
}
let _treeSprites = null;
function treeSprites() {
  if (_treeSprites) return _treeSprites;
  _treeSprites = [];
  // A single smooth ellipse + faint internal gradient reads as a glossy
  // sphere once magnified for a close-up 3D view (the old 2 lobes were too
  // faint to survive the blur). Fix: 3 overlapping jittered-blob lobes give
  // an irregular, multi-lump SILHOUETTE (not just internal color variation),
  // plus mottled puffs for dappled shading — reads as foliage at any zoom.
  const shades = [["#3a7a40", "#16351c"], ["#457f3b", "#1b3d1e"], ["#3c7448", "#173920"], ["#4c8442", "#204322"]];
  const S = 96;
  let seed = 0xdec1d5;
  for (const [lite, dark] of shades) {
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d");
    const rnd = mulberry32(seed); seed = (seed + 0x9e3779b9) >>> 0;
    // 3 overlapping lobes (one big + two smaller offset clumps) build a lumpy
    // multi-lobed crown outline instead of one round blob.
    const lobes = [
      { cx: S * 0.5, cy: S * 0.5, r: S * 0.36 },
      { cx: S * 0.28 + rnd() * S * 0.08, cy: S * 0.58 + rnd() * S * 0.08, r: S * 0.22 },
      { cx: S * 0.68 + rnd() * S * 0.08, cy: S * 0.42 + rnd() * S * 0.1, r: S * 0.24 },
    ];
    for (const { cx, cy, r } of lobes) {
      const rg = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.15);
      rg.addColorStop(0, lite); rg.addColorStop(1, dark);
      g.fillStyle = rg;
      blobPath(g, cx, cy, r, 0.4, 9, rnd, 0.92);
      g.fill();
    }
    // small mottled puffs on top for dappled internal texture
    for (let i = 0; i < 7; i++) {
      const ang = rnd() * Math.PI * 2, rad = rnd() * S * 0.3;
      const cx = S * 0.5 + Math.cos(ang) * rad, cy = S * 0.5 + Math.sin(ang) * rad * 0.9;
      const pr = S * (0.1 + rnd() * 0.1);
      g.globalAlpha = 0.3 + rnd() * 0.3;
      g.fillStyle = rnd() > 0.5 ? lite : dark;
      blobPath(g, cx, cy, pr, 0.5, 7, rnd, 0.9);
      g.fill();
    }
    g.globalAlpha = 1;
    _treeSprites.push(c);
  }
  return _treeSprites;
}
function buildTrees() {
  const out = [];
  const rnd = mulberry32(0xa11ce);
  const hMin = TUNE.treeHMin, hSpan = TUNE.treeHMax - TUNE.treeHMin;
  const mk = (x, y) => out.push({ x, y, h: hMin + rnd() * hSpan, r: 1.1 + rnd() * 0.9, s: (rnd() * 4) | 0 });
  const m = HOLE._mask;
  if (m && m.lab) {
    const src = m.canopy || m.lab; // pre-erosion woods = the canopy you see
    // Forest field F = mask WOODS ∪ aerial-dark OB cells. The mask classifier
    // deliberately files everything outside the playing envelope under OB —
    // so on forest-ringed courses (Four Oaks: 2202 WOODS cells in a 402×512
    // mask, ALL of them speckle) nearly the whole visible canopy carries no
    // WOODS label and grew no trees. The aerial knows better: OB cells whose
    // photo pixel is dark and not blue (water guard) are real canopy — same
    // "trust what you SEE" call the mask itself makes for OOB. OB-only vote,
    // so shadow streaks on playable rough (class 2) can't sprout trees.
    const F = new Uint8Array(src.length);
    let forest = 0;
    for (let i = 0; i < src.length; i++) if (src[i] === 3) { F[i] = 1; forest++; }
    const aimg = HOLE._img, aer = HOLE.aerial;
    if (aimg && HOLE._imgReady && aer && aer.toWorld && m.w2p) {
      try {
        const cnv = document.createElement("canvas");
        cnv.width = m.w; cnv.height = m.h;
        const g2 = cnv.getContext("2d", { willReadFrequently: true });
        // aerial px -> mask px = w2p ∘ aerial.toWorld (fold the processAerial
        // bake upsample out of the first two columns, like drawAerial does)
        const A = aer.toWorld, W = m.w2p, up = aimg._up || 1;
        const Ta = W[0] * A[0] + W[1] * A[3], Tc = W[0] * A[1] + W[1] * A[4],
              Te = W[0] * A[2] + W[1] * A[5] + W[2];
        const Tb = W[3] * A[0] + W[4] * A[3], Td = W[3] * A[1] + W[4] * A[4],
              Tf = W[3] * A[2] + W[4] * A[5] + W[5];
        g2.setTransform(Ta / up, Tb / up, Tc / up, Td / up, Te, Tf);
        g2.drawImage(aimg, 0, 0);
        const pd = g2.getImageData(0, 0, m.w, m.h).data;
        const lab = m.lab;
        // Two canopy cues, because luma alone can't separate canopy from turf
        // here (measured on Four Oaks NAIP: forest p50 luma 79-101 vs open
        // rough p50 90 — full overlap). Sunlit canopy is MID-bright but
        // heavily textured (dappled crowns/shadows at ~3yd/cell), mowed turf
        // is smooth; so: "weak" = dark enough to be shadowed canopy, "strong"
        // = green-ish + mid-luma + high local contrast. Gray car speckle in
        // parking lots is high-contrast too but fails the green test.
        const lum = new Float32Array(lab.length);
        const greenish = new Uint8Array(lab.length);
        for (let i = 0; i < lab.length; i++) {
          const o = i * 4;
          if (pd[o + 3] < 200) { lum[i] = 255; continue; } // outside aerial footprint: never canopy
          const r = pd[o], g = pd[o + 1], b = pd[o + 2];
          lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
          greenish[i] = (g >= b - 8 && g >= r - 6) ? 1 : 0;
        }
        const canopy = new Uint8Array(lab.length); // 1 = weak (creep-only), 2 = strong (self-vote)
        for (let py = 0; py < m.h; py++) for (let px = 0; px < m.w; px++) {
          const i = py * m.w + px;
          if (!greenish[i] || lum[i] >= 150) continue;
          let varN = 0; // max abs luma step to a 4-neighbor — cheap texture probe
          if (px > 0) varN = Math.max(varN, Math.abs(lum[i] - lum[i - 1]));
          if (px < m.w - 1) varN = Math.max(varN, Math.abs(lum[i] - lum[i + 1]));
          if (py > 0) varN = Math.max(varN, Math.abs(lum[i] - lum[i - m.w]));
          if (py < m.h - 1) varN = Math.max(varN, Math.abs(lum[i] - lum[i + m.w]));
          if (varN >= TUNE.treeTexture && lum[i] < 135) canopy[i] = 2;
          else if (lum[i] < TUNE.treeDarkLum) canopy[i] = 1;
        }
        for (let i = 0; i < lab.length; i++) {
          if (F[i]) continue;
          // OB votes on either cue; ROUGH self-votes only on the strong
          // (textured) cue — a tree-shadow streak on open rough is dark but
          // SMOOTH, so it needs the creep below and a forest to creep from.
          if ((lab[i] === 0 && canopy[i]) || (lab[i] === 2 && canopy[i] === 2)) { F[i] = 1; forest++; }
        }
        // Fringe creep: the envelope dilation files the first ~10-30yd of real
        // forest around every hole under ROUGH; weak-cue ROUGH cells join only
        // by touching already-confirmed forest, one cell (~3yd) per pass.
        // FAIRWAY cells never vote (mow-stripe shadows).
        for (let pass = 0; pass < TUNE.treeFringePasses; pass++) {
          let grew = 0;
          for (let py = 0; py < m.h; py++) for (let px = 0; px < m.w; px++) {
            const i = py * m.w + px;
            if (F[i] || lab[i] !== 2 || !canopy[i]) continue;
            n8: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const nx = px + dx, ny = py + dy;
              if (nx >= 0 && ny >= 0 && nx < m.w && ny < m.h && F[ny * m.w + nx] === 1) {
                F[i] = 3; grew++; break n8; // 3 = grew this pass; promoted below so one pass ≈ one cell of creep
              }
            }
          }
          for (let i = 0; i < F.length; i++) if (F[i] === 3) F[i] = 1;
          forest += grew;
          if (!grew) break;
        }
      } catch (e) { /* tainted canvas / decode hiccup — keep mask-only forest */ }
    }
    // Edge-biased sampling: a uniform lottery spreads treeMax over ALL forest —
    // most of the budget lands deep in off-course woodland and the tree line
    // actually SEEN from the fairway comes out sparse. From ground level (3D)
    // the boundary rows are the whole visual; the interior reads as texture.
    // So boundary cells (any non-forest within treeEdgeR) keep trees at
    // treeEdgeBoost × the interior's treeInteriorMul rate. Edges classified in
    // one up-front pass (F: 1 = interior, 2 = edge) and the per-cell rate is
    // normalized so the EXPECTED total is treeMax — an out.length cap on a
    // row-major scan planted every tree in the top band of the map and left
    // the rest of the course bare.
    const boost = TUNE.treeEdgeBoost, intMul = TUNE.treeInteriorMul, eR = TUNE.treeEdgeR;
    let edgeN = 0;
    for (let py = 0; py < m.h; py++) for (let px = 0; px < m.w; px++) {
      const i = py * m.w + px;
      if (!F[i]) continue;
      let edge = false;
      scan: for (let dy = -eR; dy <= eR; dy += 2) for (let dx = -eR; dx <= eR; dx += 2) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || !F[ny * m.w + nx]) { edge = true; break scan; }
      }
      if (edge) { F[i] = 2; edgeN++; }
    }
    const unit = TUNE.treeMax / Math.max(1, edgeN * boost + (forest - edgeN) * intMul);
    const rateEdge = Math.min(1, unit * boost), rateInt = Math.min(1, unit * intMul);
    const t = m.toWorld;
    const water = (HOLE.surfaces && HOLE.surfaces.water) || [];
    for (let py = 0; py < m.h; py++) for (let px = 0; px < m.w; px++) {
      const f = F[py * m.w + px];
      if (!f || rnd() > (f === 2 ? rateEdge : rateInt)) continue;
      const jx = px + rnd(), jy = py + rnd();
      const x = t[0] * jx + t[1] * jy + t[2], y = t[3] * jx + t[4] * jy + t[5];
      // Murky ponds read green-ish + dark — the aerial vote can't tell them
      // from canopy, but the OSM water polys can. No trees in the water.
      if (inAnyPoly(x, y, water)) continue;
      mk(x, y);
    }
  } else {
    // OSM woods fallback: distribute the budget across ALL stands (not
    // first-come), and keep trees inside the playable world rect — global
    // courses keep surrounding forest polys that extend past it.
    const polys = ((HOLE.surfaces && HOLE.surfaces.woods) || []).map((poly) => {
      const bb = polyBBox(poly);
      return { poly, bb, area: (bb.maxx - bb.minx) * (bb.maxy - bb.miny) };
    });
    const total = polys.reduce((s, p) => s + p.area, 0);
    const density = total > 0 ? Math.min(0.22, TUNE.treeMax / total) : 0;
    const W = HOLE.world || WORLD;
    for (const { poly, bb } of polys) {
      const n = Math.ceil((bb.maxx - bb.minx) * (bb.maxy - bb.miny) * density);
      for (let i = 0; i < n && out.length < TUNE.treeMax; i++) {
        const x = bb.minx + rnd() * (bb.maxx - bb.minx);
        const y = bb.miny + rnd() * (bb.maxy - bb.miny);
        if (x < 0 || y < 0 || x > W.w || y > W.h) continue;
        if (pointInPoly(x, y, poly)) mk(x, y);
      }
      if (out.length >= TUNE.treeMax) break;
    }
  }
  return out;
}
const TREE_DRAW_CAP = 900; // visible-per-frame ceiling (stride-thinned above it)
function drawTrees() {
  const kz = view.kz;
  if (!kz || !HOLE || HOLE.isRange || greenView || cine) return;
  if (ws(TUNE.treeHMax) * kz < 2.5) return; // too zoomed-out to read as height
  if (ensureCanopyLayer()) return;          // photo canopy extrusion covers it
  const holder = course || HOLE;
  // The mask decodes async — don't bake trees from the OSM fallback while a
  // mask is still on its way; rebuild once it lands (mask wins on quality).
  // Aerial folded into the cache key too: buildTrees also reads the photo
  // (OB-forest augmentation), so trees rebuild once when the aerial lands.
  const hasMask = !!(HOLE._mask && HOLE._mask.lab);
  if (!hasMask && HOLE._maskExpected) return;
  const treeSig = hasMask + ":" + !!HOLE._imgReady;
  if (!holder._trees || holder._treesFromMask !== treeSig) {
    holder._trees = buildTrees();
    holder._treesFromMask = treeSig;
  }
  const trees = holder._trees;
  if (!trees.length) return;
  const v = _viewAABB, cssW = window.innerWidth, cssH = window.innerHeight;
  const arr = [];
  for (const t of trees) {
    if (t.x < v.minx || t.x > v.maxx || t.y < v.miny || t.y > v.maxy) continue;
    arr.push(t);
  }
  const stride = Math.max(1, Math.ceil(arr.length / TREE_DRAW_CAP));
  const sprites = treeSprites();
  // viewpoint parity with the photo-canopy punch-outs: no tree may cover the
  // ball, the cup, or the green in play
  const b = state.ball, hp = HOLE.holePos;
  const clearR = TUNE.punchBallR * 1.2;
  const gip = HOLE.isRange ? [] : greensInPlay();
  const drawn = [];
  for (let i = 0; i < arr.length; i += stride) {
    const t = arr[i];
    if (b && Math.hypot(t.x - b.x, t.y - b.y) < clearR) continue;
    if (hp && Math.hypot(t.x - hp.x, t.y - hp.y) < TUNE.punchCupR * 1.2) continue;
    if (gip.some((g) => pointInPoly(t.x, t.y, g.poly))) continue;
    const sx = wx(t.x, t.y);
    if (sx < -30 || sx > cssW + 30) continue;
    const sy = wyg(t.x, t.y);
    if (sy < -60 || sy > cssH + 60) continue;
    drawn.push({ t, sx, sy });
  }
  drawn.sort((a, b) => a.sy - b.sy); // painter: far (upper) trees first
  ctx.save();
  for (const { t, sx, sy } of drawn) {
    const rr = ws(t.r), lift = ws(t.h) * kz;
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = "#08170c";
    ctx.beginPath();
    ctx.ellipse(sx + rr * 0.35, sy + rr * 0.12, rr * 0.95, rr * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.92;
    const d = rr * 2.3;
    ctx.drawImage(sprites[t.s], sx - d / 2, sy - lift - d * 0.52, d, d);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// --- Photo-canopy extrusion (tilted view) ----------------------------------
// On photo courses the trees ARE in the aerial — so instead of pasting sprite
// billboards over them, cut the woods pixels out of the graded aerial (mask
// canopy cells -> feathered alpha) and extrude that cutout: stacked dark
// silhouettes from the ground up form the side wall, then the full-color
// cutout drawn lifted by ws(canopyH)·kz is the canopy top. The forest rises
// out of the photo with its own texture, color and real sun shadows intact.
// Layer = { mask, img, tiers } where tiers = [{ c, dark, hMul }] (null → sprite
// fallback). Cells are despeckled (isolated shadow-noise cells die) and split
// into 3 clump-scale height tiers so the silhouette breaks into staggered
// clumps instead of one uniform-height slab. Tops bake at half aerial res,
// walls at quarter res with an omni-directional smear (rotation-safe) so two
// stacked copies read as a continuous soft wall.
function buildCanopyLayer(m, img, a) {
  const out = { mask: m, img, tiers: null };
  try {
    const w = Math.round(a.w), h = Math.round(a.h);   // source aerial px
    if (!w || !h) return out;
    const src = m.canopy || m.lab;
    // 1. despeckle: keep a woods cell only with ≥2 of 8 woods neighbors —
    // isolated cells (tree shadows, classifier noise) otherwise become
    // floating 3-yd slabs once extruded.
    const kept = new Uint8Array(src.length);
    for (let py = 0; py < m.h; py++) for (let px = 0; px < m.w; px++) {
      const i = py * m.w + px;
      if (src[i] !== 3) continue;
      let n = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const qx = px + ox, qy = py + oy;
        if (qx >= 0 && qy >= 0 && qx < m.w && qy < m.h && src[qy * m.w + qx] === 3) n++;
      }
      if (n >= 2) kept[i] = 1;
    }
    // 2. tier per cell by clump-scale hash (2×2 mask cells ≈ 6yd clumps)
    const tiers = TUNE.canopyTiers;
    const tierOf = (px, py) => Math.min(tiers.length - 1, (hashSeed(px >> 1, py >> 1) * tiers.length) | 0);
    // 3. mask px -> aerial px affine = inv(aerial.toWorld) ∘ mask.toWorld
    const A = a.toWorld, M = m.toWorld;
    const det = A[0] * A[4] - A[1] * A[3];
    if (Math.abs(det) < 1e-12) return out;
    const m11 = (A[4] * M[0] - A[1] * M[3]) / det;
    const m12 = (-A[3] * M[0] + A[0] * M[3]) / det;
    const m21 = (A[4] * M[1] - A[1] * M[4]) / det;
    const m22 = (-A[3] * M[1] + A[0] * M[4]) / det;
    const dx = (A[4] * (M[2] - A[2]) - A[1] * (M[5] - A[5])) / det;
    const dy = (-A[3] * (M[2] - A[2]) + A[0] * (M[5] - A[5])) / det;
    // world units per aerial px (for the wall smear radius)
    const wpp = Math.hypot(A[0], A[3]) || 1;
    const built = [];
    for (let t = 0; t < tiers.length; t++) {
      // alpha of this tier's cells, mask res
      const am = document.createElement("canvas");
      am.width = m.w; am.height = m.h;
      const ag = am.getContext("2d");
      const id = ag.createImageData(m.w, m.h);
      for (let py = 0; py < m.h; py++) for (let px = 0; px < m.w; px++) {
        const i = py * m.w + px;
        if (!kept[i] || tierOf(px, py) !== t) continue;
        const o = i * 4;
        id.data[o] = id.data[o + 1] = id.data[o + 2] = id.data[o + 3] = 255;
      }
      ag.putImageData(id, 0, 0);
      // feather the hard cell squares (blur filter when supported, else a
      // 5-draw offset composite — build-time, mask-res, cheap either way)
      const fm = document.createElement("canvas");
      fm.width = m.w; fm.height = m.h;
      const fg = fm.getContext("2d");
      fg.filter = "blur(" + TUNE.canopyFeather + "px)";
      if (fg.filter && fg.filter.indexOf("blur") !== -1) {
        fg.drawImage(am, 0, 0);
        fg.filter = "none";
      } else {
        const o = TUNE.canopyFeather;
        fg.globalAlpha = 0.4;
        for (const [ox, oy] of [[-o, 0], [o, 0], [0, -o], [0, o]]) fg.drawImage(am, ox, oy);
        fg.globalAlpha = 1;
        fg.drawImage(am, 0, 0);
      }
      // color top: half aerial res, aerial pixels kept where the alpha says so
      const c = document.createElement("canvas");
      c.width = Math.max(1, w >> 1); c.height = Math.max(1, h >> 1);
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.setTransform(m11 / 2, m12 / 2, m21 / 2, m22 / 2, dx / 2, dy / 2);
      g.drawImage(fm, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.drawImage(img, 0, 0, img.width, img.height, 0, 0, c.width, c.height);
      // probe: oversize canvases fail silently on iOS — bail to sprite fallback
      if (!g.getImageData(c.width >> 1, c.height >> 1, 1, 1)) return out;
      // wall: quarter res, darkened, omni-smeared (camera rotates per hole, so
      // the smear must be direction-free)
      const q = document.createElement("canvas");
      q.width = Math.max(1, w >> 2); q.height = Math.max(1, h >> 2);
      const qg = q.getContext("2d");
      qg.imageSmoothingEnabled = true;
      qg.drawImage(c, 0, 0, q.width, q.height);
      qg.globalCompositeOperation = "source-atop";
      qg.fillStyle = "rgba(10,26,12,0.88)";
      qg.fillRect(0, 0, q.width, q.height);
      const d = document.createElement("canvas");
      d.width = q.width; d.height = q.height;
      const dg = d.getContext("2d");
      dg.imageSmoothingEnabled = true;
      const sm = Math.max(1, (TUNE.canopyH / 3) / wpp / 4);
      dg.globalAlpha = 0.35;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        dg.drawImage(q, Math.cos(ang) * sm, Math.sin(ang) * sm);
      }
      dg.globalAlpha = 1;
      dg.drawImage(q, 0, 0);
      built.push({ c, dark: d, hMul: tiers[t] });
    }
    out.tiers = built;
  } catch (e) { /* no canopy layer -> sprite fallback */ }
  return out;
}
function ensureCanopyLayer() {
  const m = HOLE._mask, img = HOLE._img, a = HOLE.aerial;
  if (!m || !m.lab || !img || !a || !HOLE._imgReady) return null;
  const holder = course || HOLE;
  let L = holder._canopyLayer;
  if (!L || L.mask !== m || L.img !== img) {
    L = holder._canopyLayer = buildCanopyLayer(m, img, a);
  }
  return L.tiers ? L : null;
}
let _canopyScratch = null; // reused capture-aligned canvas: tiers paint here,
                           // viewpoint punch-outs erase, then one composite
function drawCanopy() {
  if (!view.kz || !HOLE || HOLE.isRange || greenView || cine) return;
  const L = ensureCanopyLayer();
  if (!L) return;
  const tiers = L.tiers;
  const topLift = ws(TUNE.canopyH * tiers[tiers.length - 1].hMul) * view.kz;
  if (topLift < 2) return;                     // too zoomed out to read
  // compose source-aerial px -> screen, same pattern as drawAerial (up = 1)
  const m = HOLE.aerial.toWorld, dpr = window.devicePixelRatio || 1;
  const A = view.a * m[0] + view.b * m[3];
  const C = view.a * m[1] + view.b * m[4];
  const E = view.a * m[2] + view.b * m[5] + view.c;
  const B = view.d * m[0] + view.e * m[3];
  const D = view.d * m[1] + view.e * m[4];
  const F = view.d * m[2] + view.e * m[5] + view.f;
  const det = A * D - C * B;
  if (Math.abs(det) < 1e-9) return;
  // visible source rect: screen corners (viewport + capture pad + lift head-
  // room below, since every layer shifts content UP) back through the inverse
  const cssW = window.innerWidth, cssHFull = window.innerHeight + 2 * _capPad;
  const cssH = cssHFull + topLift;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [scx, scy] of [[0, 0], [cssW, 0], [0, cssH], [cssW, cssH]]) {
    const ddx = scx - E, ddy = scy - F;
    const px = (D * ddx - C * ddy) / det;
    const py = (-B * ddx + A * ddy) / det;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  const aw = tiers[0].c.width * 2, ah = tiers[0].c.height * 2;  // full aerial px
  const sx = Math.max(0, Math.floor(minX) - 1);
  const sy = Math.max(0, Math.floor(minY) - 1);
  const sw = Math.min(aw, Math.ceil(maxX) + 1) - sx;
  const sh = Math.min(ah, Math.ceil(maxY) + 1) - sy;
  if (sw <= 0 || sh <= 0) return;
  // tiers paint into a capture-aligned scratch so the viewpoint punch-outs
  // (destination-out) erase CANOPY only, never the ground under it
  const devW = Math.round(cssW * dpr), devH = Math.round(cssHFull * dpr);
  if (!_canopyScratch || _canopyScratch.width !== devW || _canopyScratch.height !== devH) {
    _canopyScratch = document.createElement("canvas");
    _canopyScratch.width = devW; _canopyScratch.height = devH;
  }
  const g = _canopyScratch.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, devW, devH);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  const layer = (cnv, offY, sc, alpha) => {
    g.globalAlpha = alpha;
    g.setTransform(dpr * A * sc, dpr * B * sc, dpr * C * sc, dpr * D * sc, dpr * E, dpr * (F - offY));
    g.drawImage(cnv, sx / sc, sy / sc, sw / sc, sh / sc, sx / sc, sy / sc, sw / sc, sh / sc);
  };
  // staggered clumps: all walls first, then tops shortest -> tallest so taller
  // clumps overdraw — the broken silhouette is what kills the "raised platform"
  const walls = _warpMotion ? 1 : TUNE.tWallLayers;
  for (const t of tiers) {
    const liftT = ws(TUNE.canopyH * t.hMul) * view.kz;
    for (let k = 0; k < walls; k++) layer(t.dark, liftT * (k + 0.5) / walls, 4, 0.8);
  }
  for (const t of tiers) layer(t.c, ws(TUNE.canopyH * t.hMul) * view.kz, 2, 1);
  // Viewpoint punch-outs: the canopy must never hide the ball, the cup, or the
  // green in play. view.f is pad-shifted during capture, so wx/wyg land in
  // scratch space directly.
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalCompositeOperation = "destination-out";
  const punch = (px, py, r) => {
    const rg = g.createRadialGradient(px, py, r * 0.55, px, py, r);
    rg.addColorStop(0, "rgba(0,0,0,1)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = 1;
    g.fillStyle = rg;
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.fill();
  };
  const b = state.ball;
  punch(wx(b.x, b.y), wyg(b.x, b.y), Math.max(ws(TUNE.punchBallR), 48));
  punch(wx(HOLE.holePos.x, HOLE.holePos.y), wyg(HOLE.holePos.x, HOLE.holePos.y),
        Math.max(ws(TUNE.punchCupR), 40));
  for (const gr of greensInPlay()) {
    g.beginPath();
    gr.poly.forEach((pt, i) => {
      const px = wx(pt.x, pt.y), py = wyg(pt.x, pt.y);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    });
    g.closePath();
    g.fillStyle = "#000";
    g.fill();
    g.lineWidth = ws(TUNE.punchGreenFeather * 2);
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(_canopyScratch, 0, 0, devW, devH, 0, 0, cssW, cssHFull);
  ctx.restore();
}

// --- Fairway wash (baked once per hole) -----------------------------------
// The feathered fairway tint used to be re-filled + ctx.filter-blurred every
// single frame in drawPhotoSurfaces — a full-screen software blur pass 60x/sec
// in the default (flat, photoreal) mode. The polygons and their blur are
// static per hole, so bake them once into a world-space raster (same
// pixel-space-affine + composed-transform trick as buildDEMShade below) and
// blit it each frame — one drawImage instead of one blur-fill.
const FAIRWAY_WASH_RES = 4; // raster px per world unit
function buildFairwayWash(surfaces) {
  const res = FAIRWAY_WASH_RES;
  const w = Math.max(1, Math.round(WORLD.w * res)), h = Math.max(1, Math.round(WORLD.h * res));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.beginPath();
  let any = false;
  for (const poly of surfaces.fairway || []) {
    if (!poly || poly.length < 2) continue;
    g.moveTo(poly[0].x * res, poly[0].y * res);
    for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x * res, poly[i].y * res);
    g.closePath();
    any = true;
  }
  if (!any) return null;
  g.fillStyle = "#8ad98f";
  if ("filter" in g) g.filter = `blur(${FAIRWAY_FEATHER_UNITS * res}px)`;
  g.fill();
  return { canvas: c, m: [1 / res, 0, 0, 0, 1 / res, 0] };
}
const FAIRWAY_FEATHER_UNITS = 6 / 12; // ~ old 6css-px feather at a typical ~12 screen-px/world-unit zoom
function drawFairwayWash() {
  const s = HOLE.surfaces;
  if (!HOLE._fairwayWash) HOLE._fairwayWash = buildFairwayWash(s) || false;
  const wash = HOLE._fairwayWash;
  if (!wash) return;
  const t = wash.m, dpr = window.devicePixelRatio || 1;
  const A = view.a * t[0] + view.b * t[3], C = view.a * t[1] + view.b * t[4], E = view.a * t[2] + view.b * t[5] + view.c;
  const B = view.d * t[0] + view.e * t[3], D = view.d * t[1] + view.e * t[4], F = view.d * t[2] + view.e * t[5] + view.f;
  ctx.save();
  ctx.setTransform(dpr * A, dpr * B, dpr * C, dpr * D, dpr * E, dpr * F);
  ctx.globalAlpha = 0.12;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(wash.canvas, 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
}

// --- DEM hillshade (tilted view) ------------------------------------------
// One grayscale light/shadow raster per course at DEM resolution, composited
// over the ground while tilted so slopes read even where the photo is flat-lit.
function buildDEMShade(dem) {
  const { nx, ny, data } = dem;
  const c = document.createElement("canvas");
  c.width = nx; c.height = ny;
  const g = c.getContext("2d"), id = g.createImageData(nx, ny);
  const dx = (dem.x1 - dem.x0) / (nx - 1), dy = (dem.y1 - dem.y0) / (ny - 1);
  // slope -> signed NW-light shade, normalized to the course's own relief
  const shade = new Float32Array(nx * ny);
  let mx = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1);
    const j0 = Math.max(0, j - 1), j1 = Math.min(ny - 1, j + 1);
    const gx = (data[j * nx + i1] - data[j * nx + i0]) / ((i1 - i0) * dx || 1);
    const gy = (data[j1 * nx + i] - data[j0 * nx + i]) / ((j1 - j0) * dy || 1);
    const s = (gx + gy) * 0.7071; // light from world NW
    shade[j * nx + i] = s;
    const a = Math.abs(s); if (a > mx) mx = a;
  }
  const inv = mx > 1e-6 ? 1 / mx : 0;
  for (let k = 0; k < nx * ny; k++) {
    const s = Math.max(-1, Math.min(1, shade[k] * inv * 1.4));
    const o = k * 4;
    if (s < 0) { id.data[o] = id.data[o + 1] = id.data[o + 2] = 255; id.data[o + 3] = -s * 255; }
    else { id.data[o] = id.data[o + 1] = id.data[o + 2] = 0; id.data[o + 3] = s * 255; }
  }
  g.putImageData(id, 0, 0);
  return { canvas: c, m: [dx, 0, dem.x0, 0, dy, dem.y0] };
}
function drawDEMShade() {
  if (!view.kz || !HOLE._dem || !HOLE._demRec) return;
  const holder = course || HOLE;
  if (!holder._demShade) holder._demShade = buildDEMShade(HOLE._demRec);
  const sh = holder._demShade;
  const kzFull = Math.sqrt(Math.max(0.01, 1 - TUNE.tiltCos * TUNE.tiltCos)) * TUNE.tExag;
  const alpha = TUNE.tHillAlpha * Math.min(1, view.kz / kzFull);
  if (alpha < 0.01) return;
  const t = sh.m, dpr = window.devicePixelRatio || 1;
  const A = view.a * t[0] + view.b * t[3], C = view.a * t[1] + view.b * t[4], E = view.a * t[2] + view.b * t[5] + view.c;
  const B = view.d * t[0] + view.e * t[3], D = view.d * t[1] + view.e * t[4], F = view.d * t[2] + view.e * t[5] + view.f;
  ctx.save();
  ctx.setTransform(dpr * A, dpr * B, dpr * C, dpr * D, dpr * E, dpr * F);
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sh.canvas, 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Photoreal rendering: real aerial base + translucent play-surface overlays.
function drawPhotoSurfaces() {
  const s = HOLE.surfaces;
  drawAerial(); // grade + course-green wash are baked into the image (processAerial)
  drawDetailGrain(); // zoom-ramped turf grain over the stretched photo
  drawDEMShade();    // tilted only: DEM light/shadow so slopes read on the photo
  drawFairwayWash();                               // gentle feathered fairway tint, baked once per hole
  ctx.strokeStyle = "rgba(60,48,18,0.45)";          // bunkers: outline (sand visible)
  ctx.lineWidth = 1.2;
  for (const poly of s.bunker || []) { if (!polyVisible(poly)) continue; tracePoly(poly); ctx.stroke(); }
  ctx.globalAlpha = 0.4;                           // water tint
  fillPolys(s.water, "#1f86d8");
  ctx.globalAlpha = 1;
  drawGreen(true);
  drawOOBOverlay(s);                               // red OOB tint over aerial
  drawCanopy();      // tilted only: the photo's own woods pixels, extruded
}

let ballTrail = [];   // recent airborne ball positions (screen px) for motion trail
let penaltyAnim = null; // { t0, fx, fy } — render-only fade-out at the hazard, fade-in at the drop
let _vignette = null; // cached edge-darkening gradient, keyed to viewport size

// --- Juice: particles + camera punch + toast --------------------------------
// Particles live in WORLD coords so they ride the camera (rotation/zoom) like
// everything else; drawn via wx/wy each frame, culled when life runs out.
let particles = [];
function spawnBurst(x, y, kind) {
  const N = kind === "confetti" ? 46 : kind === "splash" ? 18 : 10;
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (kind === "confetti" ? 0.10 + Math.random() * 0.22
              : kind === "splash" ? 0.06 + Math.random() * 0.14
              : 0.03 + Math.random() * 0.08);
    let color;
    if (kind === "confetti") color = `hsl(${Math.floor(Math.random() * 360)},90%,62%)`;
    else if (kind === "splash") color = "rgba(150,200,255,0.9)";
    else color = "rgba(210,196,160,0.85)"; // dust
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === "dust" ? 0 : 0.04),
      life: 1, decay: 0.012 + Math.random() * 0.02,
      size: kind === "confetti" ? 2.4 + Math.random() * 2.4 : 1.6 + Math.random() * 1.6,
      color, grav: kind === "dust" ? 0.0005 : 0.0016,
    });
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.vx *= 0.985; p.vy *= 0.985;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}
function drawParticles() {
  for (const p of particles) {
    const sx = wx(p.x, p.y), sy = wy(p.x, p.y);
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(sx, sy, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Camera punch: a brief zoom-in bump that eases back (decays in updateCamera),
// applied on top of camera.scale in applyView. Subtle — research warns against
// over-juicing.
let camPunch = 0;
function cameraPunch(amt) { camPunch = Math.max(camPunch, amt || 0.03); }

// Lightweight transient toast (reuses a single DOM node).
let _toastTimer = null;
function showToast(text, ms, tone) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("toast-gold", tone === "gold");
  el.classList.toggle("toast-warn", tone === "warn");
  el.classList.remove("hidden");
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.classList.remove("show"); el.classList.add("hidden"); }, ms || 1600);
}

function drawWindIndicator() {
  if (!HOLE || HOLE.isRange || mode !== "course" || wind.speed < 1) return;
  const cssW = window.innerWidth;

  // Wind push vector in world space (FROM dir → pushes opposite)
  const pwx = -Math.sin(wind.dir), pwy = Math.cos(wind.dir);
  // Project to screen via view rotation (a,b,d,e)
  const svx = view.a * pwx + view.b * pwy;
  const svy = view.d * pwx + view.e * pwy;
  const screenAngle = Math.atan2(svy, svx);

  // Below the notch / Dynamic Island. On mobile the top bar cluster (scorecard
  // + docked shot-info) spans the top-left, so anchor the pill just below
  // whichever of those is currently the lowest, or it hides behind them.
  let cx = cssW / 2, cy = safeInset.t + 22;
  if (!IS_DESKTOP) {
    const barEl = (elStats && !elStats.classList.contains("hidden")) ? elStats : elScorecard;
    const b = barEl ? barEl.getBoundingClientRect().bottom : 0;
    cy = (b > 0 ? b : safeInset.t + 47) + 20;
  }
  const spd = Math.round(wind.speed);
  const label = spd + " mph";

  ctx.save();
  ctx.font = "bold 13px system-ui, sans-serif";
  const tw = ctx.measureText(label).width;
  const arrowGap = 26, pillW = arrowGap + 6 + tw + 10, pillH = 26, r = 7;
  const px = cx - pillW / 2, py = cy - pillH / 2;

  // pill background (matches --glass tokens)
  ctx.fillStyle = "rgba(13,26,18,0.72)";
  ctx.beginPath();
  ctx.roundRect(px, py, pillW, pillH, r);
  ctx.fill();

  // arrow — points toward where wind blows on screen
  const arrowCx = px + 16, arrowCy = cy;
  const AL = 9, AH = 6; // shaft half-length, head size
  const cos = Math.cos(screenAngle), sin = Math.sin(screenAngle);
  ctx.strokeStyle = "#ece5d3"; ctx.lineWidth = 2; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(arrowCx - cos * AL, arrowCy - sin * AL);
  ctx.lineTo(arrowCx + cos * AL, arrowCy + sin * AL);
  ctx.stroke();
  ctx.fillStyle = "#ece5d3";
  ctx.beginPath();
  ctx.moveTo(arrowCx + cos * AL, arrowCy + sin * AL);
  ctx.lineTo(arrowCx + cos * AL - cos * AH + sin * AH * 0.55,
             arrowCy + sin * AL - sin * AH - cos * AH * 0.55);
  ctx.lineTo(arrowCx + cos * AL - cos * AH - sin * AH * 0.55,
             arrowCy + sin * AL - sin * AH + cos * AH * 0.55);
  ctx.closePath();
  ctx.fill();

  // speed label
  ctx.fillStyle = "rgba(236,229,211,0.92)";
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(label, px + arrowGap + 4, cy);
  ctx.restore();
}
let _surround = null; // cached course-green surround gradient, keyed to viewport size
const FLAG_FAR = 70, FLAG_NEAR = 12; // world-unit range over which the flag shrinks

// Tee markers: two blocks flanking the teeing ground, square to the play line,
// so the tee box reads clearly on the photo (and in the preview flyover).
function drawTeeMarkers() {
  const t = HOLE.teePos, p = HOLE.holePos;
  const ang = Math.atan2(p.y - t.y, p.x - t.x);    // play direction
  const px = -Math.sin(ang), py = Math.cos(ang);   // unit perpendicular (world)
  const off = 1.8;                                  // world units to each side
  const r = Math.max(ws(0.4), 5);                   // marker radius (screen px floor)
  for (const sgn of [-1, 1]) {
    const mx = wx(t.x + px * off * sgn, t.y + py * off * sgn);
    const my = wyg(t.x + px * off * sgn, t.y + py * off * sgn);
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.25)";   // soft drop shadow
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx - r * 0.18, my - r * 0.18, r, 0, Math.PI * 2);
    ctx.fillStyle = "#2563eb";            // blue tee marker
    ctx.fill();
    ctx.lineWidth = Math.max(r * 0.22, 1);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
  }
}

// The ground-surface draw sequence between startGroundCapture/finishGroundWarp
// (or straight to screen when flat/untilted) — shared by draw()'s own rebuild
// path and bakeBucket() so the two can't drift apart.
function drawGroundStack(cssW, cssH, warp) {
  if (HOLE._imgReady && HOLE.aerial) {
    // surround the aerial with a dark course-green wash (a gradient that reads as
    // the rest of the course) rather than a hard black box.
    if (!_surround || _surround.w !== cssW || _surround.h !== cssH) {
      const g = ctx.createLinearGradient(0, 0, 0, cssH);
      g.addColorStop(0, "#13351c");
      g.addColorStop(1, "#0c2614");
      _surround = { w: cssW, h: cssH, grad: g };
    }
    ctx.fillStyle = _surround.grad;
    ctx.fillRect(0, 0, cssW, cssH + 2 * _capPad);
    drawPhotoSurfaces();
  } else {
    drawVectorSurfaces();
  }

  // shaded-relief topo. Whisper-faint always; the slope button boosts it. In
  // tilted mode this is baked INTO the warp cache, so it must NOT depend on the
  // ball's green (that's what forced a full ground+tree rebuild after every
  // shot) — bake it for ALL visible greens so the cache is shot-independent.
  // Flat mode has no cache, so keep the in-play-only look there.
  if (!HOLE.isRange) {
    const reliefGreens = warp ? (HOLE._greens || []) : greensInPlay();
    for (const g of reliefGreens) {
      if (!polyVisible(g.poly)) continue;
      drawGreenRelief(g, showSlope ? TUNE.reliefFull : TUNE.reliefAmbient, showSlope && breakArrows);
    }
  }
}

function draw() {
  // Four Oaks 3D: three.js owns the whole frame (course, ball, flag, camera) via
  // window.Course3D.render() in loop(); the 2D canvas is hidden (update3DMode)
  // so there is nothing to paint here. Every other course is unaffected.
  if (render3D) return;
  const cssW = window.innerWidth, cssH = window.innerHeight;
  // Butter Brook: Apple MapKit is this course's ground layer, always (not a
  // render3D-style full-frame mode) — see appleGroundActive()/syncAppleGround()
  // above. Everything below (flag, ball, contours, HUD icons) still runs
  // exactly as it does for every other course; only the ground-paint chain
  // (tilt3d/warp/drawGroundStack) is swapped out for this course.
  const appleGround = appleGroundActive();
  if (!appleGround) leaveAppleGround(); // no-ops unless we just left the course/mode
  // Tilted 3D: route the whole ground stack through the offscreen capture +
  // cache whenever tilted — with a DEM the column-band warp displaces it (pad
  // = measured max lift), without one (pad 0) it's a straight cached copy, so
  // heavy tilt layers (photo-canopy extrusion) still cost one blit parked.
  // Butter Brook never engages this — real Apple tilt lands in a later stage
  // (see the plan) instead of the fake canvas warp.
  const tilt3d = !appleGround && !!(view.kz && !HOLE.isRange && !greenView && !cine);
  _warpPad = tilt3d ? estimateWarpPad(cssW, cssH) : 0;
  computeViewAABB(); // for off-screen polygon culling this frame
  const warp = tilt3d;
  const wSig = warp ? warpSig(cssW, cssH) : null;
  // Sweeping = the camera is actively rotating via arrow-key aiming (the one
  // sustained, pure-rotation motion source — see angle-bucket cache above).
  // Excludes two-finger touch-rotate (camTouch, moves scale/focus too every
  // frame — ghosting a translated blend is much worse than a rotated one) and
  // mid tilt-toggle-transition (brief, already fast via the camEaseT snap).
  let bucketBlend = null;
  if (warp && (aimKey !== 0 || cameraAiming) && !camTouch && camera.tilt === camera.tTilt) {
    const bKey = baseWarpKey(cssW, cssH);
    const i0 = angleBucketIndex(camera.angle), i1 = (i0 + 1) % TUNE.tAngleBuckets;
    const e0 = _bucketCache.get(bKey + "#" + i0), e1 = _bucketCache.get(bKey + "#" + i1);
    if (e0 && e1) bucketBlend = { e0, e1, frac: angleBucketFrac(camera.angle) };
  }
  // Camera parked but the last rebuild was a degraded motion frame → rebuild
  // once at full quality so the parked cache never shows the coarse version.
  const settle = warp && _warpCache && _warpCache.sig === wSig && _warpCache.degraded;
  if (appleGround) {
    ctx.clearRect(0, 0, cssW, cssH + 2 * _capPad);
    syncAppleGround();
    // The full ground stack is skipped (Apple IS the ground), but the green
    // reading aids are gameplay, not ground: the translucent green tint +
    // topo contours (drawGreen) and the shaded relief are what let you read
    // break — without them putting on this course is blind. Same photo-mode
    // treatment every aerial course gets, minus the aerial itself.
    if (!HOLE.isRange) {
      drawGreen(true);
      // Relief follows the pitched view too — drawGreenRelief linearizes the
      // pinhole about each green's centroid for its raster blit.
      for (const g of greensInPlay()) {
        if (!polyVisible(g.poly)) continue;
        drawGreenRelief(g, showSlope ? TUNE.reliefFull : TUNE.reliefAmbient, showSlope && breakArrows);
      }
    }
  } else if (bucketBlend) {
    // Cross-dissolve the two bracketing pre-baked angle buckets — zero
    // recapture. Never touches _warpCache/sig, so the instant the sweep ends
    // the very next frame falls straight into an ordinary (undegraded,
    // _sigStreak still 0) rebuild at full quality.
    const now = performance.now();
    bucketBlend.e0.ts = bucketBlend.e1.ts = now;
    ctx.drawImage(bucketBlend.e0.canvas, 0, 0, cssW, cssH);
    ctx.globalAlpha = bucketBlend.frac;
    ctx.drawImage(bucketBlend.e1.canvas, 0, 0, cssW, cssH);
    ctx.globalAlpha = 1;
    _sigStreak = 0; _warpMotion = false;
  } else if (warp && _warpCache && _warpCache.sig === wSig && !settle) {
    // parked camera: the warped ground is identical to last frame — one blit
    ctx.drawImage(_warpCache.canvas, 0, 0, cssW, cssH);
    _sigStreak = 0; _warpMotion = false;
  } else {
  if (warp) {
    // 2+ consecutive rebuilds = the camera is really moving (not a one-off
    // invalidation): drop to coarser bands / thinner canopy / no grain.
    _sigStreak = settle ? 0 : _sigStreak + 1;
    _warpMotion = _sigStreak >= 2;
  }
  if (warp) startGroundCapture(cssW, cssH);
  drawGroundStack(cssW, cssH, warp);
  if (warp) finishGroundWarp(cssW, cssH, wSig);
  }  // end of ground rebuild (skipped entirely on a warp-cache hit or bucket blend)
  // (tilted always goes through the capture+cache now, so trees/canopy are
  // baked in there; nothing draws live here when flat — kz=0 no-ops drawTrees)
  // animated flow dots draw ABOVE the (possibly cached) ground so they never
  // force a ground re-render; wyg() keeps them glued to the displaced turf
  if (!HOLE.isRange && showSlope && !breakArrows && !greenView) {
    // Tilted + zoomed out, the dots shrink into dark grit on the greens —
    // fade them out below the readable-zoom ramp (flat mode unchanged).
    const fFade = view.kz
      ? Math.min(1, Math.max(0, (view.scale - TUNE.flowFadeLo) / (TUNE.flowFadeHi - TUNE.flowFadeLo)))
      : 1;
    if (fFade > 0) for (const g of greensInPlay()) {
      if (!polyVisible(g.poly)) continue;
      updateFlowDots(g); drawFlowDots(g, fFade);
    }
  }

  // target rings on the range; the cup + flag on the course
  if (HOLE.isRange) {
    const tx = wx(HOLE.holePos.x, HOLE.holePos.y), ty = wy(HOLE.holePos.x, HOLE.holePos.y);
    ctx.lineWidth = 2;
    for (const rr of [9, 6, 3]) { // concentric yard rings
      ctx.beginPath();
      ctx.arc(tx, ty, ws(rr / YARDS_PER_UNIT), 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(230,40,40,0.85)";
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(tx, ty, Math.max(ws(1 / YARDS_PER_UNIT), 4), 0, Math.PI * 2);
    ctx.fillStyle = "#e02a25";
    ctx.fill();
  } else {
  drawTeeMarkers();   // flank the tee box so it reads clearly
  // hole cup — dark hole with a bright rim so it reads on the photo. A circle
  // on the ground foreshortens with the camera tilt, so ry scales by view.tilt.
  const hx = wx(HOLE.holePos.x, HOLE.holePos.y), hy = wyg(HOLE.holePos.x, HOLE.holePos.y), hr = Math.max(ws(HOLE.holeRadius), 3);
  ctx.beginPath();
  ctx.ellipse(hx, hy, hr, hr * view.tilt, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#0a1f0f";
  ctx.fill();
  ctx.lineWidth = Math.max(hr * 0.18, 1);
  ctx.strokeStyle = "rgba(245,245,235,0.85)";
  ctx.stroke();

  // flagstick: shrinks as the ball nears the cup, and is "pulled" (hidden, only
  // the hole shows) once the ball is on the green.
  const _b = state.ball;
  const ballOnGreen = surfaceAt(_b.x, _b.y) === "green";
  const dToHole = Math.hypot(_b.x - HOLE.holePos.x, _b.y - HOLE.holePos.y);
  if (!ballOnGreen) {
    let fs = (dToHole - FLAG_NEAR) / (FLAG_FAR - FLAG_NEAR);
    fs = 0.55 + 0.45 * Math.max(0, Math.min(1, fs)); // 0.55 (near) .. 1 (far)
    const poleH = Math.max(ws(0.78), 22) * fs, topX = hx, topY = hy - poleH;
    ctx.strokeStyle = "rgba(0,0,0,0.28)";   // short ground shadow of the stick
    ctx.lineWidth = 2.5 * fs;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + ws(4) * fs, hy + ws(1));
    ctx.stroke();
    ctx.strokeStyle = "#f4f4f0";             // the pole
    ctx.lineWidth = 2 * fs;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(topX, topY);
    ctx.stroke();
    const t = performance.now() / 180;       // waving red pennant flying right
    const flagL = Math.max(ws(0.5), 15) * fs, flagH = Math.max(ws(0.32), 10) * fs;
    const w1 = Math.sin(t) * Math.max(ws(0.05), 1.6) * fs, w2 = Math.sin(t + 1.2) * Math.max(ws(0.06), 2) * fs;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(topX + flagL * 0.5, topY - w1, topX + flagL, topY + flagH * 0.5 + w2);
    ctx.quadraticCurveTo(topX + flagL * 0.5, topY + flagH * 0.5 + w1, topX, topY + flagH);
    ctx.closePath();
    ctx.fillStyle = "#e02a25";
    ctx.fill();
    ctx.strokeStyle = "rgba(120,15,12,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  }

  // ball + shadow — shadow sits on the ground at (x,y), ball is lifted by height z
  if (!state.inHole) {
    const b = state.ball;
    const gx = wx(b.x, b.y), gy = wyg(b.x, b.y); // ground (shadow) position
    // Screen pixels the ball floats above ground. Under the Apple pinhole the
    // height is projected for real (appleProjPt takes z) — flight arcs
    // foreshorten correctly instead of using the flat screen-lift.
    const lift = view.appleProj
      ? gy - appleProjPt(view.appleProj, b.x, b.y, b.z + _apGroundZ(view.appleProj, b.x, b.y)).y
      : ws(b.z);
    // Keep the ball clearly visible at every zoom (floor in screen px); real
    // scale only takes over when zoomed in far enough to exceed the floor.
    const baseR = Math.max(ws(BALL_RADIUS_UNITS), 4);

    // motion trail while airborne — fades from tail to ball
    if (b.z > 0.4) {
      ballTrail.push({ x: gx, y: gy - lift });
      if (ballTrail.length > 10) ballTrail.shift();
    } else {
      ballTrail.length = 0;
    }
    for (let i = 1; i < ballTrail.length; i++) {
      const f = i / ballTrail.length;
      ctx.strokeStyle = `rgba(255,255,255,${f * 0.4})`;
      ctx.lineWidth = baseR * f * 1.2;
      ctx.beginPath();
      ctx.moveTo(ballTrail[i - 1].x, ballTrail[i - 1].y);
      ctx.lineTo(ballTrail[i].x, ballTrail[i].y);
      ctx.stroke();
    }

    // live shot preview: marker + yardage at the predicted landing/rest spot,
    // forward-simulated from the swing-in-progress (opt-in, shotPreviewEnabled).
    // Falls back to a plain direction-only tick while below the swing threshold
    // or before the first preview resolves.
    if (shotPreview && !state.moving && !cine && !greenView) {
      const mx = wx(shotPreview.rest.x, shotPreview.rest.y), my = wyg(shotPreview.rest.x, shotPreview.rest.y);
      ctx.setLineDash([3, 6]);                     // tighter dash than the range-finder's [6,5] — visually distinct
      ctx.strokeStyle = "rgba(120,200,255,0.55)";   // cool blue vs range-finder's white/gold — never confused with a manual measurement
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(mx, my); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(120,200,255,0.25)"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(120,200,255,0.95)"; ctx.stroke();
      ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(120,200,255,0.95)"; ctx.fill();
      drawLabel(mx, my - 18, shotPreview.holed ? "IN!" : Math.round(shotPreview.yards) + " yds", "#7cc8ff");
    } else if (swipePath && swipePath.length >= 2 && !state.moving) {
      // live swipe: thin direction-only tick from the ball — echoes that input is
      // registering without giving any power/landing assist
      const p0 = swipePath[0], pl = swipePath[swipePath.length - 1];
      const sdx = pl.x - p0.x, sdy = pl.y - p0.y, sm = Math.hypot(sdx, sdy);
      if (sm > 12) {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + (sdx / sm) * 48, gy + (sdy / sm) * 48);
        ctx.stroke();
      }
    }

    // penalty drop: fade out at the hazard, reappear fading in at the drop spot
    // (render-only; physics already placed the ball at lastSafe)
    let pbx = gx, pby = gy, pAlpha = 1;
    if (penaltyAnim) {
      const pp = (performance.now() - penaltyAnim.t0) / 500;
      if (pp >= 1) penaltyAnim = null;
      else if (pp < 0.5) {
        pbx = wx(penaltyAnim.fx, penaltyAnim.fy);
        pby = wy(penaltyAnim.fx, penaltyAnim.fy);
        pAlpha = 1 - pp * 2;
      } else {
        pAlpha = (pp - 0.5) * 2;
      }
    }
    ctx.globalAlpha = pAlpha;

    // shadow shrinks slightly as the ball climbs
    const shR = baseR * Math.max(0.45, 1 - b.z * 0.012);
    ctx.beginPath();
    ctx.ellipse(pbx, pby, shR, shR * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fill();

    // ball grows slightly with height; top-left highlight for a 3D feel
    const r = baseR * (1 + b.z * 0.012);
    const bx = pbx, by = pby - lift;
    const rg = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.35, r * 0.1, bx, by, r);
    rg.addColorStop(0, "#ffffff");
    rg.addColorStop(0.6, "#f2f2ee");
    rg.addColorStop(1, "#cfcfc7");
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.strokeStyle = "rgba(120,120,110,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (holeDrop) {
    // ball-into-cup. Two beats: (1) roll the last bit to the cup, decelerating, with a
    // rim rattle if it arrived with pace; (2) the ball drops BELOW the lip — clipped to
    // the cup so the near rim occludes it as it falls and darkens into the hole. That
    // occlusion (not a shrink-to-nothing) is what reads as a real hole-out.
    const baseR = Math.max(ws(BALL_RADIUS_UNITS), 4);
    const hx = wx(HOLE.holePos.x, HOLE.holePos.y), hy = wyg(HOLE.holePos.x, HOLE.holePos.y);
    const hr = Math.max(ws(HOLE.holeRadius), 3);
    const p = Math.min(1, (performance.now() - holeDrop.t0) / HOLE_DROP_MS);
    const easeOut = (x) => 1 - Math.pow(1 - x, 3), easeIn = (x) => x * x * x;
    // roll-in: entry point -> just past centre toward the FAR lip (catches it)
    const a = easeOut(Math.min(1, p / 0.34));
    const sp = Math.hypot(holeDrop.vx, holeDrop.vy) || 1;
    const dirx = holeDrop.vx / sp, diry = holeDrop.vy / sp;       // heading
    const overX = HOLE.holePos.x + dirx * HOLE.holeRadius * 0.45; // far-lip catch
    const overY = HOLE.holePos.y + diry * HOLE.holeRadius * 0.45;
    let wxp = holeDrop.x + (overX - holeDrop.x) * a;
    let wyp = holeDrop.y + (overY - holeDrop.y) * a;
    const wob = (1 - p) * (1 - p) * Math.min(0.5, sp * 2.2) * Math.sin(p * 50); // rattle
    wxp += (-diry) * wob; wyp += (dirx) * wob;
    const bx = wx(wxp, wyp), by = wy(wxp, wyp);
    const s = easeIn(Math.max(0, (p - 0.34) / 0.66));            // 0..1 sink
    if (s <= 0) {
      // still rolling on the surface — full white ball
      ctx.beginPath(); ctx.arc(bx, by, baseR, 0, Math.PI * 2);
      ctx.fillStyle = "#f4f4ef"; ctx.fill();
      ctx.strokeStyle = "rgba(120,120,110,0.7)"; ctx.lineWidth = 1; ctx.stroke();
    } else {
      // sinking: clip to the cup; ball falls toward + past the rim and darkens
      const mix = (c0, c1) => Math.round(c0 + (c1 - c0) * s);
      const fall = s * hr * 1.6;                                  // drop below the lip
      const r = baseR * (1 - 0.25 * s);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(hx, hy, hr * 1.02, hr * 1.02 * view.tilt, 0, 0, Math.PI * 2); ctx.clip();
      ctx.beginPath(); ctx.arc(bx, by + fall, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${mix(244, 14)},${mix(244, 30)},${mix(237, 18)})`;
      ctx.fill();
      ctx.restore();
    }
  }

  // live match: the opponent's ball (arc tween while their shot flies, else at rest)
  if (liveMatch()) drawOppGhost();

  // celebration / impact particles (above the play surface + ball)
  updateParticles();
  drawParticles();

  // vignette — darken edges to draw the eye toward the hole
  if (!_vignette || _vignette.w !== cssW || _vignette.h !== cssH) {
    const g = ctx.createRadialGradient(cssW / 2, cssH * 0.45, Math.min(cssW, cssH) * 0.35,
                                       cssW / 2, cssH * 0.5, Math.max(cssW, cssH) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    _vignette = { w: cssW, h: cssH, grad: g };
  }
  ctx.fillStyle = _vignette.grad;
  ctx.fillRect(0, 0, cssW, cssH);

  // Wind is shown as a DOM chip in the top HUD card (updateWindChip), not a
  // canvas pill — so it can never overlap the pin near screen-top-center.

  // range finder: dashed lines ball->marker and marker->pin with yard labels
  if (measurePoint) {
    const b = state.ball;
    const bx = wx(b.x, b.y), by = wyg(b.x, b.y);
    const mx = wx(measurePoint.x, measurePoint.y), my = wyg(measurePoint.x, measurePoint.y);
    const px = wx(HOLE.holePos.x, HOLE.holePos.y), py = wyg(HOLE.holePos.x, HOLE.holePos.y);
    // pressed a green (ball off it): show front/middle/back of that green instead
    // of the marker->pin readout
    const gHit = (HOLE._greens || []).find((g) => pointInPoly(measurePoint.x, measurePoint.y, g.poly));
    const fmb = gHit && !pointInPoly(b.x, b.y, gHit.poly) ? greenFMB(gHit) : null;
    ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(mx, my); ctx.stroke();   // ball -> marker
    if (!fmb) {
      ctx.strokeStyle = "rgba(255,214,90,0.9)";
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(px, py); ctx.stroke(); // marker -> pin
    }
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    const yBall = Math.round(dist(b.x, b.y, measurePoint.x, measurePoint.y) * YARDS_PER_UNIT);
    const yPin = Math.round(dist(measurePoint.x, measurePoint.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT);
    // Elevation change in feet (DEM = everywhere; fallback = greens only)
    function elevLabel(fromX, fromY, toX, toY) {
      const raw0 = terrainElevAt(fromX, fromY), raw1 = terrainElevAt(toX, toY);
      if (raw0 === null && raw1 === null) return "";
      const df = Math.round(((raw1 ?? raw0) - (raw0 ?? raw1)) * 10) / 10;
      if (Math.abs(df) < 0.5) return "";
      return " " + (df > 0 ? "↑" : "↓") + Math.abs(df) + "ft";
    }
    drawLabel((bx + mx) / 2, (by + my) / 2, yBall + " yds" + elevLabel(b.x, b.y, measurePoint.x, measurePoint.y), "#fff");
    if (fmb) {
      // dots where the ball->center ray crosses the green edge
      for (const pt of [fmb.front, fmb.back]) {
        ctx.beginPath(); ctx.arc(wx(pt.x, pt.y), wy(pt.x, pt.y), 3, 0, Math.PI * 2);
        ctx.fillStyle = "#ffd65a"; ctx.fill();
      }
      drawLabel(mx, my - 70, "Back "  + Math.round(fmb.back.d  * YARDS_PER_UNIT), "#fff");
      drawLabel(mx, my - 46, "Mid "   + Math.round(fmb.mid.d   * YARDS_PER_UNIT), "#ffd65a");
      drawLabel(mx, my - 22, "Front " + Math.round(fmb.front.d * YARDS_PER_UNIT), "#fff");
    } else {
      drawLabel((mx + px) / 2, (my + py) / 2, yPin + " yds" + elevLabel(measurePoint.x, measurePoint.y, HOLE.holePos.x, HOLE.holePos.y), "#ffd65a");
    }
  }

  // 3D green inspect overlay (scrim + tilted mesh) — everything above keeps
  // rendering beneath it; the hole-transition fade below still covers it.
  drawGreenView();
  drawCine();   // cinematic 3D landing (same overlay slot; never open together)

  // hole-change transition: fade out to course-green, swap the hole at the
  // midpoint (starting zoomed out so the camera eases in), then fade back.
  if (holeTransition) {
    const p = Math.min(1, (performance.now() - holeTransition.t0) / holeTransition.dur);
    const a = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5; // 0 -> 1 -> 0
    if (p >= 0.5 && !holeTransition.swapped) {
      holeTransition.advance();
      camera.scale = camera.tScale * 0.6; // start zoomed out, let updateCamera ease in
      holeTransition.swapped = true;
    }
    ctx.fillStyle = `rgba(11,40,21,${a.toFixed(3)})`;
    ctx.fillRect(0, 0, cssW, cssH);
    if (p >= 1) holeTransition = null;
  }

  drawAttribution();
}

// On-map data/imagery credit (ODbL requires visible OSM attribution; NAIP/Esri
// terms ask for an imagery credit). Bottom-left, faint, only while the map is on
// screen (not behind the home menu). Originals aren't OSM-derived so they skip
// the OSM line; the menu fineprint carries the clickable openstreetmap.org link.
function drawAttribution() {
  if (!HOLE || HOLE.isRange) return;
  if (!elMenu.classList.contains("hidden")) return;   // hidden behind the home menu
  const meta = COURSES.find((c) => c.id === selectedCourseId);
  const isOriginal = meta && meta.region === "Originals";
  const src = HOLE.aerial && HOLE.aerial.src;
  const lines = [
    isOriginal ? "" : "© OpenStreetMap contributors",
    HOLE.aerial ? (src === "naip" ? "Imagery: USGS / NAIP" : "Imagery © Esri") : "",
  ].filter(Boolean);
  if (!lines.length) return;
  ctx.save();
  ctx.font = "10px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "bottom";
  const pad = 6;
  // The Tour Events scorebug owns the bottom-left corner during a tour round —
  // move the credit to the bottom-right so they don't overlap.
  const bugUp = tourPlayMode && mode === "course";
  ctx.textAlign = bugUp ? "right" : "left";
  const x = bugUp ? window.innerWidth - pad : pad;
  let y = window.innerHeight - pad;
  for (let i = lines.length - 1; i >= 0; i--) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.strokeText(lines[i], x, y);
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fillText(lines[i], x, y);
    y -= 13;
  }
  ctx.restore();
}

// Animate a hole change: `advanceFn` performs the actual setHole at the fade midpoint.
function advanceHole(advanceFn) {
  if (holeTransition) return;
  holeTransition = { t0: performance.now(), dur: 850, advance: advanceFn, swapped: false };
}

// =====================================================================
//  Scorecard / result UI
// =====================================================================
const elStrokes = document.getElementById("strokes");
const elScore = document.getElementById("score");
const elScoreLabel = document.getElementById("score-label");
const elResult = document.getElementById("result");
const elHint = document.getElementById("hint");
const elHoleLabel = document.getElementById("holeLabel");
const elCourse = document.getElementById("course");
const elPar = document.getElementById("par");
const elYards = document.getElementById("yards");

// Running total across completed holes. Score shows E until a hole is finished.
const round = { score: 0, holesPlayed: 0, holeStats: [], pinSeed: 0 };

function formatToPar(d) {
  if (d === 0) return "E";
  return d > 0 ? "+" + d : String(d);
}
function updateScorecard() {
  if (elCourse) elCourse.textContent = course ? course.name : "";
  if (elHoleLabel) elHoleLabel.textContent = "Hole " + (HOLE.num || 1);
  elPar.textContent = HOLE.par;
  elYards.textContent = HOLE.yards;
  elStrokes.textContent = state.strokes;
  // 1v1 match play: the number that matters is holes up/down, not gross score.
  const me = matchPlay() ? meSnapshot() : null;
  if (me && lastOpp) {
    const mp = computeMatchPlay(me, lastOpp, matchHoleCount);
    if (elScoreLabel) elScoreLabel.textContent = "Match";
    elScore.textContent = mp.result || mp.status;
    elScore.className = mp.diff > 0 ? "under" : mp.diff < 0 ? "over" : "even";
  } else {
    if (elScoreLabel) elScoreLabel.textContent = "Score";
    elScore.textContent = formatToPar(round.score);
    elScore.className = round.score < 0 ? "under" : round.score > 0 ? "over" : "even";
  }
  positionStatsBar();
}

// Mobile: dock the shot-info panel directly under the top scorecard bar so the
// two read as one top-of-screen bar (frees the crowded bottom-left corner).
// Desktop keeps its own fixed top-right panel — clearing the inline top lets the
// base CSS govern there. Called on layout changes only (not per frame).
function positionStatsBar() {
  // Shot info now flows inside the scorecard card (no docking). Clear any legacy
  // inline top a previous build left behind so it doesn't offset the in-card block.
  if (elStats) elStats.style.top = "";
}
function hideHint() {
  elHint.classList.add("hidden");
  // Undo any dynamic positionHint() override so the default CSS placement
  // (bottom-centered pill) is clean if the hint is ever shown again.
  elHint.style.left = elHint.style.top = elHint.style.right = elHint.style.bottom = "";
  elHint.style.transform = "";
}
// The swing hint only teaches the gesture once per round (hole 1's tee shot),
// so it never becomes a permanent nag. Anchored a fixed distance ABOVE the
// teed-up ball's on-screen position rather than a fixed screen offset — a
// bottom-pinned pill would sometimes land right on top of the ball depending
// on how a given hole's tee frames.
function positionHint() {
  if (!elHint) return;
  const bx = wx(state.ball.x, state.ball.y), by = wyg(state.ball.x, state.ball.y);
  const r = elHint.getBoundingClientRect();
  elHint.style.transform = "none";
  placeHudEl(elHint, bx - r.width / 2, by - r.height - 28);
}

// =====================================================================
//  Personal bests + milestones (localStorage — no server, works offline)
// =====================================================================
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

function getBests() { return lsGet("golf.bests", { perCourse: {}, perHole: {} }); }
function setBests(b) { lsSet("golf.bests", b); }
// The course these bests belong to (daily uses its real underlying course id).
function bestsCourseId() { return (course && course.id) || selectedCourseId || "fallback"; }

// Compare this hole's strokes to the stored best; update + report {isBest, prev}.
function recordHoleBest(holeNum, strokes) {
  const b = getBests();
  const key = bestsCourseId() + ":" + holeNum;
  const prev = b.perHole[key];
  const isBest = prev == null || strokes < prev;
  if (isBest) { b.perHole[key] = strokes; setBests(b); }
  return { isBest, prev };
}
// Same for a whole round (by to-par; strokes breaks ties).
function recordCourseBest(toPar, strokes) {
  const b = getBests();
  const key = bestsCourseId();
  const prev = b.perCourse[key];
  const isBest = !prev || toPar < prev.toPar || (toPar === prev.toPar && strokes < prev.strokes);
  if (isBest) { b.perCourse[key] = { toPar, strokes, date: new Date().toISOString().slice(0, 10) }; setBests(b); }
  return { isBest, prev };
}
function courseBest(id) { return getBests().perCourse[id || bestsCourseId()] || null; }

// First-time milestones — fire a toast once, then remember.
function getMilestones() { return lsGet("golf.milestones", {}); }
function earnMilestone(id) {
  const m = getMilestones();
  if (m[id]) return false;
  m[id] = new Date().toISOString().slice(0, 10);
  lsSet("golf.milestones", m);
  return true;
}
// A milestone can unlock a marquee course (ACHIEVEMENT_COURSES) — toast it
// after the milestone's own toast has had its moment.
function announceMilestoneUnlocks(msId, delayMs) {
  for (const cid in ACHIEVEMENT_COURSES) {
    if (ACHIEVEMENT_COURSES[cid].milestone !== msId) continue;
    const c = COURSES.find((x) => x.id === cid);
    const name = c ? c.name : cid;
    track("course_unlocked", { course: cid, via: "milestone" });
    setTimeout(() => showToast(name + " unlocked!", 2600, "gold"), delayMs);
  }
}

function showResult() {
  if (cine) closeCine();  // hole-out ends the cinematic; the result modal takes over
  const d = state.strokes - HOLE.par;
  const holeNum = HOLE.num || round.holesPlayed + 1;
  // Matches are a single locked pass. If this hole was already recorded, a
  // replay must NOT count: skip the score fold + the match-row push (either
  // would corrupt the shared standings). Show the result, flagged as void.
  if (inMatch() && round.holeStats.some(s => s.hole === holeNum)) {
    const titleEl = document.getElementById("result-title");
    titleEl.textContent = "Hole already played";
    titleEl.className = "rt-l0";
    document.getElementById("result-detail").textContent =
      `Hole ${holeNum} is already recorded in this match — replays don't count. ` +
      `Score stays ${formatToPar(round.score)}.`;
    elResult.classList.remove("hidden");
    return;
  }
  // Record per-hole stats
  round.holeStats.push({
    hole: holeNum,
    par: HOLE.par,
    strokes: state.strokes,
    gir: state.gir,
    putts: state.putts,
    proximity: state.proximity,
    fairwayHit: state.fairwayHit,
  });
  // Hole done: fold this hole's result into the running round total.
  round.score += d;
  round.holesPlayed += 1;
  updateScorecard();
  if (tourPlayMode) updateTourBug();   // refresh the live scorebug with my new cumulative
  // Live match: push my score/progress + per-hole scores so the opponent's
  // standings (and match-play status) update.
  if (matchLive()) {
    const finished = round.holesPlayed >= roundHoleCount();
    const holeScores = {};
    const holeProx = {};
    for (const h of round.holeStats) {
      holeScores[h.hole] = h.strokes;
      if (h.proximity != null) holeProx[h.hole] = h.proximity;   // yards, for closest-to-pin
    }
    const patch = {
      score: round.score, holes_played: round.holesPlayed, finished,
      updated_at: new Date().toISOString(),
      hole_scores: holeScores, hole_prox: holeProx, cur_hole: HOLE.num, cur_strokes: state.strokes,
      cur_to_pin: -1, cur_at_rest: true,
      cur_x: HOLE.holePos.x, cur_y: HOLE.holePos.y,
    };
    // Live match: broadcast the holing shot as an arc into the cup (the capture
    // path skips the normal at-rest push), then clear the pending-shot marker.
    if (liveMatch() && _shotFrom) {
      const distU = dist(_shotFrom.x, _shotFrom.y, HOLE.holePos.x, HOLE.holePos.y);
      const durMs = Math.max(450, Math.min(4000, performance.now() - _shotT0));
      patch.cur_shot = { seq: _matchSeq, hole: HOLE.num,
        fromX: _shotFrom.x, fromY: _shotFrom.y, toX: HOLE.holePos.x, toY: HOLE.holePos.y,
        durMs: Math.round(durMs), peak: distU * 0.16, lie: "green" };
    }
    _shotFrom = null;
    patchMyMatchRow(patch);
    if (matchPlay()) checkMatchCloseout();
  }
  const names = { "-3": "Albatross!", "-2": "Eagle!", "-1": "Birdie!",
                  "0": "Par", "1": "Bogey", "2": "Double bogey" };
  const title = state.strokes === 1 ? "Hole in one!" : (names[String(d)] || (d > 0 ? "+" + d : d));

  // Escalating celebration level: 0 par/worse · 1 birdie · 2 eagle · 3 albatross · 4 ace
  let level = 0;
  if (state.strokes === 1) level = 4;
  else if (d <= -3) level = 3;
  else if (d === -2) level = 2;
  else if (d === -1) level = 1;

  // Personal best on this hole (skip the range; daily/course both count).
  // A conceded pickup isn't a real hole score — never a "best", never a modal.
  const conceded = state._conceded; state._conceded = false;
  const hb = (HOLE.isRange || conceded) ? { isBest: false } : recordHoleBest(holeNum, state.strokes);

  // Rewarded "replay this hole": offered only on a bad solo-round hole (bogey+),
  // once per hole, and only when an ad is available. Player-initiated (see ADS.md).
  const canRetry = !HOLE.isRange && mode === "course" && !inMatch() && !dailyMode &&
    !activeTournamentRound && course && d >= 1 &&
    !(round._retried && round._retried.has(holeIndex)) && adsAvailable();

  // Ordinary hole (par or worse, no personal best, mid-round): skip the modal —
  // quick score toast + auto-advance. A forced tap on all 18 holes adds up.
  // A retry-eligible blow-up forces the modal so the offer can be shown.
  if ((level === 0 || conceded) && !hb.isBest && !dailyMode && !matchDecided && !canRetry &&
      !(course && holeIndex >= roundHoleCount() - 1)) {
    // Match play: say what the hole meant ("Hole lost · 2 down") when the
    // opponent's score is already in; otherwise the running score.
    const mo = matchHoleOutcomeText(holeNum);
    showToast((conceded ? "Picked up" : title) + " · " + (mo || formatToPar(round.score)), mo ? 2200 : 1600);
    setTimeout(advanceFromResult, mo ? 1500 : 1100);
    return;
  }

  const titleEl = document.getElementById("result-title");
  titleEl.textContent = title;
  titleEl.className = "rt-l" + level + (hb.isBest ? " rt-best" : "");

  let detail = `${state.strokes} stroke${state.strokes === 1 ? "" : "s"} · ${formatToPar(d)} this hole · ${formatToPar(round.score)} total`;
  if (hb.isBest && hb.prev != null) detail += `\nNew best on this hole! (was ${hb.prev})`;
  else if (hb.isBest && hb.prev == null && !HOLE.isRange) detail += `\nFirst time on this hole — best set`;
  else if (hb.prev != null) detail += `\nYour best: ${hb.prev}` + (state.strokes > hb.prev ? ` — ${state.strokes - hb.prev} to beat` : "");
  document.getElementById("result-detail").textContent = detail;
  const retryBtn = document.getElementById("result-retry");
  if (retryBtn) {
    if (canRetry) { _retryCtx = { d, holeNum }; retryBtn.disabled = false; retryBtn.classList.remove("hidden"); }
    else { _retryCtx = null; retryBtn.classList.add("hidden"); }
  }
  elResult.classList.remove("hidden");

  // Juice: sound + confetti + camera punch scaled to the moment
  if (level >= 1) {
    playCelebrate(level);
    cameraPunch(0.02 + 0.012 * level);
    const hp = HOLE.holePos;
    spawnBurst(hp.x, hp.y, "confetti");
    if (level >= 3) { spawnBurst(hp.x, hp.y, "confetti"); spawnBurst(hp.x, hp.y, "confetti"); }
  }

  // First-time milestone toasts (once ever, per device)
  let ms = null;
  if (level === 4 && earnMilestone("first-ace")) { ms = "First hole-in-one!"; announceMilestoneUnlocks("first-ace", 2800); }
  else if (level >= 2 && earnMilestone("first-eagle")) ms = "First eagle!";
  else if (level === 1 && earnMilestone("first-birdie")) ms = "First birdie!";
  if (ms) setTimeout(() => showToast(ms, 2200, "gold"), 400);
}

// Leave the result (modal tap OR the quick-path auto-advance) and move on.
function advanceFromResult() {
  elResult.classList.add("hidden");
  // Daily is a single hole → straight to the summary (streak + share live there)
  if (dailyMode) { showRoundSummary(); return; }
  // Match play closed out (one player up by more than the holes left) → end now.
  if (matchDecided) { showRoundSummary(); return; }
  // Last hole → show full round summary instead of advancing. A match plays a
  // capped number of holes (9 or 18), so end on roundHoleCount() not the full
  // course length.
  if (course && holeIndex >= roundHoleCount() - 1) {
    showRoundSummary();
    return;
  }
  const doAdvance = () => advanceHole(() => {
    if (course) {
      holeIndex = (holeIndex + 1) % course.holes.length;
      setHole(course.holes[holeIndex]);
    } else {
      setHole(FALLBACK_HOLE);
    }
  });
  // Live match: both players tee the next hole together. If the opponent hasn't
  // finished this hole yet, hold and let the poll advance once they do (the
  // camera meanwhile follows them holing out).
  if (liveMatch() && !oppFinishedHole(HOLE.num)) {
    _awaitLive = { hole: HOLE.num, advance: doAdvance, since: performance.now() };
    showToast("Waiting for " + oppName() + " to finish the hole…", 1600);
    updateLiveTurnUI();
    return;
  }
  doAdvance();
}
document.getElementById("play-again").addEventListener("click", advanceFromResult);

// Rewarded "replay this hole": undo the just-folded hole score, then re-tee the
// SAME hole. Only reachable from the modal button, which is shown only when
// canRetry (bogey+ solo hole, once per hole, ad available). See showResult/ADS.md.
let _retryCtx = null;
(function wireRetryHole() {
  const btn = document.getElementById("result-retry");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const ctx = _retryCtx;
    if (!ctx || !course) return;
    btn.disabled = true;
    const ok = await showRewarded("retry-hole");
    if (!ok) { btn.disabled = false; return; }   // cancelled — no reward, modal stays
    track("ad_reward_granted", { reason: "retry-hole" });
    // reverse this hole's fold (mirror of showResult's score/stats update)
    round.score -= ctx.d;
    round.holesPlayed -= 1;
    const j = round.holeStats.map(s => s.hole).lastIndexOf(ctx.holeNum);
    if (j >= 0) round.holeStats.splice(j, 1);
    (round._retried || (round._retried = new Set())).add(holeIndex);
    _retryCtx = null;
    updateScorecard();
    elResult.classList.add("hidden");
    advanceHole(() => setHole(course.holes[holeIndex]));   // replay same hole from the tee
  });
})();

// =====================================================================
//  Round-end summary
// =====================================================================
function scoreClass(strokes, par) {
  const d = strokes - par;
  if (d <= -2) return "re-cell-eagle";
  if (d === -1) return "re-cell-birdie";
  if (d === 0)  return "re-cell-par";
  if (d === 1)  return "re-cell-bogey";
  return "re-cell-double";
}

function buildScorecardSection(holes, showTot) {
  const pars   = holes.map(h => h.par);
  const scores = holes.map(h => h.strokes);
  const sumPar = pars.reduce((a, b) => a + b, 0);
  const sumScr = scores.reduce((a, b) => a + b, 0);
  const totPar = round.holeStats.reduce((a, h) => a + h.par, 0);
  const totScr = round.holeStats.reduce((a, h) => a + h.strokes, 0);
  const label  = holes[0].hole > 9 ? "IN" : "OUT";
  const totCls = scoreClass(totScr, totPar);

  const hRow = `<tr><th class="re-label">HOLE</th>${holes.map(h => `<th>${h.hole}</th>`).join("")}<th class="re-sep">${label}</th>${showTot ? `<th class="re-sep">TOT</th>` : ""}</tr>`;
  const pRow = `<tr><td class="re-label">PAR</td>${pars.map(p => `<td>${p}</td>`).join("")}<td class="re-sep">${sumPar}</td>${showTot ? `<td class="re-sep">${totPar}</td>` : ""}</tr>`;
  const sRow = `<tr><td class="re-label">YOU</td>${scores.map((s, i) => `<td class="${scoreClass(s, pars[i])}">${s}</td>`).join("")}<td class="re-sep">${sumScr}</td>${showTot ? `<td class="re-sep ${totCls}">${totScr}</td>` : ""}</tr>`;

  return `<table class="re-sc"><thead>${hRow}</thead><tbody>${pRow}${sRow}</tbody></table>`;
}

// Combined post-round match card: HOLE / PAR / one row per player (YOU first,
// then opponents). Reuses scoreClass + the .re-sc look. Par comes from my own
// round.holeStats (shared course); each opponent's strokes from its hole_scores
// map (bots: cpuOpp.hole_scores; humans: match_players.hole_scores). Gated to
// match end by the caller, so cards are complete.
function buildMatchScorecard(rows) {
  if (!rows || !rows.length || !round.holeStats.length) return "";
  const parOf = {}, holeNums = [];
  for (const h of round.holeStats) { parOf[h.hole] = h.par; holeNums.push(h.hole); }
  holeNums.sort((a, b) => a - b);
  const totPar = holeNums.reduce((a, n) => a + (parOf[n] || 0), 0);
  // Me first, then opponents. isMeEntry may miss a nameless guest, so fall back
  // to the first row (cpuMatchRows/fetchMatchPlayers list me first).
  const meRow = rows.find(isMeEntry) || rows[0];
  const ordered = rows.slice().sort((a, b) => (b === meRow ? 1 : 0) - (a === meRow ? 1 : 0));

  function section(nums, showTot) {
    const secLabel = nums[0] > 9 ? "IN" : "OUT";
    const sumPar = nums.reduce((a, n) => a + (parOf[n] || 0), 0);
    const hRow = `<tr><th class="re-label">HOLE</th>${nums.map(n => `<th>${n}</th>`).join("")}<th class="re-sep">${secLabel}</th>${showTot ? `<th class="re-sep">TOT</th>` : ""}</tr>`;
    const pRow = `<tr><td class="re-label">PAR</td>${nums.map(n => `<td>${parOf[n]}</td>`).join("")}<td class="re-sep">${sumPar}</td>${showTot ? `<td class="re-sep">${totPar}</td>` : ""}</tr>`;
    const rowsHtml = ordered.map(r => {
      const hs = r.hole_scores || {};
      const plab = r === meRow ? "YOU" : esc((r.player_name || "Opp").slice(0, 8));
      let sum = 0, tot = 0;
      const cells = nums.map(n => {
        const s = hs[n];
        if (s == null) return `<td>·</td>`;
        sum += s | 0;
        return `<td class="${scoreClass(s, parOf[n])}">${s}</td>`;
      }).join("");
      for (const n of holeNums) if (hs[n] != null) tot += hs[n] | 0;
      const totCls = scoreClass(tot, totPar);
      return `<tr><td class="re-label">${plab}</td>${cells}<td class="re-sep">${sum || "·"}</td>${showTot ? `<td class="re-sep ${totCls}">${tot || "·"}</td>` : ""}</tr>`;
    }).join("");
    return `<table class="re-sc"><thead>${hRow}</thead><tbody>${pRow}${rowsHtml}</tbody></table>`;
  }

  const front = holeNums.filter(n => n <= 9);
  const back  = holeNums.filter(n => n > 9);
  let html = "";
  if (front.length) html += section(front, back.length === 0);
  if (back.length)  html += section(back, true);
  return html;
}

function buildRoundScorecard() {
  const stats = round.holeStats;
  const front = stats.slice(0, Math.min(9, stats.length));
  const back  = stats.slice(9, Math.min(18, stats.length));
  let html = "";
  if (front.length) html += buildScorecardSection(front, back.length === 0);
  if (back.length)  html += buildScorecardSection(back, true);
  if (!html) html = '<div class="re-sc-empty">No holes completed yet</div>';
  document.getElementById("re-scorecard").innerHTML = html;
}

function buildRoundStats() {
  const stats = round.holeStats;
  const n = stats.length;
  const girs = stats.filter(h => h.gir).length;
  const firHoles = stats.filter(h => h.fairwayHit !== null);
  const firs = firHoles.filter(h => h.fairwayHit).length;
  const totalPutts = stats.reduce((s, h) => s + (h.putts || 0), 0);
  const proxHoles = stats.filter(h => h.proximity !== null);
  const avgProx = proxHoles.length
    ? proxHoles.reduce((s, h) => s + h.proximity, 0) / proxHoles.length : null;

  function avgByPar(p) {
    const hs = stats.filter(h => h.par === p);
    return hs.length ? (hs.reduce((s, h) => s + h.strokes, 0) / hs.length).toFixed(1) : null;
  }
  function pct(num, den) { return den > 0 ? `${num}/${den} (${Math.round(num / den * 100)}%)` : "—"; }

  const summaryRows = [
    { label: "GIR", val: pct(girs, n) },
    { label: "Fairways Hit", val: firHoles.length ? pct(firs, firHoles.length) : "N/A" },
    { label: "Total Putts", val: totalPutts },
    { label: "Proximity (avg)", val: avgProx !== null ? Math.round(avgProx * 3) + " ft" : "—" },
    { section: "Scoring Average" },
    { label: "Par 3s", val: avgByPar(3) || "—" },
    { label: "Par 4s", val: avgByPar(4) || "—" },
    { label: "Par 5s", val: avgByPar(5) || "—" },
  ];

  const perHoleRows = stats.map(h => {
    const prox = h.proximity !== null ? Math.round(h.proximity * 3) + "ft" : "—";
    return `<tr>
      <td class="re-label">${h.hole}</td>
      <td>${h.par}</td>
      <td class="${scoreClass(h.strokes, h.par)}">${h.strokes}</td>
      <td>${h.gir ? "✓" : "·"}</td>
      <td>${h.putts}</td>
      <td>${prox}</td>
    </tr>`;
  }).join("");

  const summaryHtml = summaryRows.map(r =>
    r.section
      ? `<div class="re-stat-section">${r.section}</div>`
      : `<div class="re-stat-row"><span class="re-stat-label">${r.label}</span><span class="re-stat-val">${r.val}</span></div>`
  ).join("");

  const perHoleHtml = `
    <div class="re-stat-section" style="margin-top:16px">Per Hole</div>
    <div class="re-sc-wrap">
      <table class="re-sc re-per-hole">
        <thead><tr>
          <th class="re-label">#</th>
          <th>Par</th><th>Score</th><th>GIR</th><th>Putts</th><th>Prox</th>
        </tr></thead>
        <tbody>${perHoleRows}</tbody>
      </table>
    </div>`;

  document.getElementById("re-statslist").innerHTML = summaryHtml + perHoleHtml;
}

let _roundMidRound = false;

function showRoundSummary(midRound = false) {
  _roundMidRound = midRound;
  const totStrk = round.holeStats.reduce((s, h) => s + h.strokes, 0);
  const n = course ? course.holes.length : 18;
  const played = round.holeStats.length;
  document.getElementById("re-header-title").textContent = midRound ? "Scorecard" : "Round Complete";
  document.getElementById("re-subtitle").textContent = midRound
    // `played` counts COMPLETED holes — the player is standing on the next one.
    ? `${course ? course.name : "Golf"} · Hole ${Math.min(played + 1, n)} of ${n} · ${formatToPar(round.score)}`
    : `${course ? course.name : "Golf"} · ${totStrk} (${formatToPar(round.score)})`;
  document.getElementById("re-replay").textContent = midRound ? "Resume" : "Play Again";
  // A match is a single locked round — replaying it would corrupt the shared
  // standings, so hide the replay button at the end of a match.
  document.getElementById("re-replay").classList.toggle("hidden", matchLive() && !midRound);
  // At the end of a match the only action is "Confirm scorecard" → the live
  // results page; hide the solo Home/Leaderboard actions so the flow is single.
  const matchEnd = matchLive() && !midRound;
  document.getElementById("re-confirm-match").classList.toggle("hidden", !matchEnd);
  document.getElementById("re-home").classList.toggle("hidden", matchEnd);
  document.getElementById("re-leaderboard").classList.toggle("hidden", matchEnd);
  // Share: only a finished solo/daily round is worth sharing (not mid-round peeks
  // or the single-flow match end). The viral "I played X" hook.
  document.getElementById("re-share").classList.toggle("hidden", midRound || matchEnd);
  // Book CTA: only a finished round on a real (bookable) course — no CTA mid-round,
  // no CTA for fictional Originals, no CTA on the single-flow match end.
  const showBookCta = !midRound && !matchEnd && courseIsReal(selectedCourseId);
  document.getElementById("re-book").classList.toggle("hidden", !showBookCta);
  if (showBookCta) track("book_cta_shown", { course: selectedCourseId });
  // reset to scorecard tab each open
  document.querySelectorAll(".re-tab").forEach(t => t.classList.toggle("active", t.dataset.panel === "re-card"));
  document.querySelectorAll(".re-panel").forEach(p => p.classList.toggle("hidden", p.id !== "re-card"));
  buildRoundScorecard();
  buildRoundStats();
  document.getElementById("re-tournament-row").classList.add("hidden");
  document.getElementById("re-tour-row").classList.add("hidden");
  document.getElementById("round-end").classList.remove("hidden");
  if (!midRound) {
    // The booking-conversion funnel's top-of-funnel event (PRODUCT_STRATEGY.md §8).
    if (courseIsReal(selectedCourseId)) {
      track("round_completed_real_course", { course: selectedCourseId,
        courseName: course ? course.name : selectedCourseId, strokes: totStrk, to_par: round.score });
    }
    // Personal best for the whole round → the "one more round" return hook.
    if (!dailyMode) {
      const cb = recordCourseBest(round.score, totStrk);
      const sub = document.getElementById("re-subtitle");
      if (cb.isBest && cb.prev) {
        sub.textContent += ` · New best! (was ${formatToPar(cb.prev.toPar)})`;
        spawnBurst(HOLE.holePos.x, HOLE.holePos.y, "confetti");
        setTimeout(() => showToast("New course record!", 2400, "gold"), 300);
      } else if (cb.isBest) {
        sub.textContent += " · First record set";
      } else if (cb.prev) {
        const diff = round.score - cb.prev.toPar;
        sub.textContent += ` · Best ${formatToPar(cb.prev.toPar)}` + (diff > 0 ? ` (${diff} to beat)` : "");
      }
    }
    // Under par over a full 18 → the break-par milestone (unlocks its course).
    if (!dailyMode && round.score < 0 && round.holeStats.length >= 18 && earnMilestone("break-par")) {
      setTimeout(() => showToast("Broke par — milestone earned!", 2400, "gold"), 600);
      announceMilestoneUnlocks("break-par", 3200);
    }
    if (dailyMode) finishDaily(totStrk);  // streak + share + daily board
    submitFinishedRound();                // post to regular leaderboard
    handleTournamentRoundComplete();      // post to tournament (no-op if not in tournament)
    setupTourRoundEnd(recordTourRound()); // bank the tour round + show next-round / cut / results CTA
    // Live match: mark my round finished. The player reviews this scorecard,
    // then taps "Confirm scorecard" → openMatchResults() (the live results
    // page polls until everyone's done → final placement locks in).
    if (matchLive()) {
      updateMyMatchProgress(round.score, round.holesPlayed, true);
    }
  }
}

// Round-end tab switching + actions
document.querySelectorAll(".re-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".re-tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.panel;
    document.querySelectorAll(".re-panel").forEach(p => p.classList.toggle("hidden", p.id !== target));
  });
});

document.getElementById("re-share").addEventListener("click", () => shareResult(roundShareText()));

document.getElementById("re-home").addEventListener("click", () => {
  document.getElementById("round-end").classList.add("hidden");
  activeTournamentRound = null;
  stopTournamentTimer();
  leaveMatch();           // tear down match polls/state if we were in one
  mode = "menu";
  elMenu.classList.remove("hidden");
  elHudBtn.classList.add("hidden");
  elHmClubRow.classList.add("hidden");
  closeHud();
  elScorecard.style.display = "none";
});

document.getElementById("re-replay").addEventListener("click", () => {
  if (_roundMidRound) {
    document.getElementById("round-end").classList.add("hidden");
  } else {
    startCourse();
  }
});

document.getElementById("re-book").addEventListener("click", () => {
  track("book_cta_clicked", { course: selectedCourseId });
  openBookSheet(selectedCourseId);
});
document.getElementById("bk-close").addEventListener("click", closeBookSheet);

// =====================================================================
//  Course loading & hole setup
// =====================================================================
let course = null;   // loaded course JSON ({ id, name, yardsPerUnit, holes:[] })
let holeIndex = 0;

// Build the live HOLE + WORLD from a course hole record and start it fresh.
// Global courses share one world/aerial/surfaces map across all holes (the hole
// rec only carries num/par/yards/tee/pin); standalone recs (range, fallback)
// carry their own world/surfaces/aerial.
// Choose this hole's pin from the baked pins[] (front/middle/back). Deterministic
// per round (round.pinSeed) so a round is consistent but pins move between rounds.
// Falls back to the single baked pin when none are baked.
function pickPin(rec) {
  const p = rec.pins;
  if (!p || !p.length) return { x: rec.pin.x, y: rec.pin.y };
  const seed = ((round.pinSeed | 0) ^ Math.imul((rec.num || 1), 2654435761)) >>> 0;
  const i = Math.floor(mulberry32(seed)() * p.length) % p.length;
  return p[i];
}

function setHole(rec) {
  if (greenView) closeGreenView();
  if (cine || cinePending) closeCine();
  // live match: drop any in-flight shot marker / opponent tween from the last hole
  _shotFrom = null; oppShot = null; _spectating = false;
  shot.carry = shot.total = null; shot.mph = 0; // fresh hole — no stale HUD stats
  const glob = !!(course && course.global && !rec.world);
  const src = glob ? course : rec; // where world/surfaces/aerial come from
  const pin = pickPin(rec);
  HOLE = {
    num: rec.num || 1,
    par: rec.par,
    yards: rec.yards,
    teePos: { x: rec.tee.x, y: rec.tee.y },
    holePos: { x: pin.x, y: pin.y },
    holeRadius: HOLE_RADIUS_UNITS,
    greenSpeed: rec.greenSpeed || src.greenSpeed || DEFAULT_STIMP,
    world: src.world,
    surfaces: src.surfaces,
    aerial: src.aerial || null,
    isGlobal: glob,
    _boundary: (src.boundary && src.boundary.length) ? src.boundary : null, // real OB line
  };
  roundGreens(HOLE.surfaces); // organic green edges (once per surfaces object)
  HOLE._maskExpected = !!(src.surfaceMask && src.surfaceMask.file); // decode may still be in flight
  if (glob) {
    // share precomputed DEM + topo + aerial across every hole (load once)
    if (!course._dem && course.dem) course._dem = buildDEM(course.dem);
    if (!course._greens) course._greens = buildGreenTopo(course.surfaces.green, null, course.greenTopo);  // always synthetic — DEM too coarse for green topo
    HOLE._greens = course._greens;
    HOLE._dem = course._dem || null;
    HOLE._demRec = course.dem || null; // raw grid — hillshade bakes from it
    if (course._img === undefined) {
      course._img = null; course._imgReady = false;
      if (src.aerial && src.aerial.file && typeof Image !== "undefined") {
        const img = new Image();
        img.onload = () => {
          const baked = processAerial(img);
          course._img = baked; course._imgReady = true;
          if (HOLE && HOLE.isGlobal) { HOLE._img = baked; HOLE._imgReady = true; }
        };
        img.src = "courses/" + src.aerial.file;
      }
    }
    HOLE._img = course._img; HOLE._imgReady = course._imgReady;
    // aerial surface mask (OOB / fairway / rough), shared across all holes
    if (course._mask === undefined) {
      course._mask = null;
      loadSurfaceMask(src.surfaceMask, (m) => {
        course._mask = m;
        if (HOLE && HOLE.isGlobal) HOLE._mask = m;
      });
    }
    HOLE._mask = course._mask;
  } else {
    HOLE._dem = rec.dem ? buildDEM(rec.dem) : null;
    HOLE._demRec = rec.dem || null; // raw grid — hillshade bakes from it
    HOLE._greens = buildGreenTopo(HOLE.surfaces.green, null, rec.greenTopo || (course && course.greenTopo));  // always synthetic
    HOLE._img = null; HOLE._imgReady = false;
    if (src.aerial && src.aerial.file && typeof Image !== "undefined") {
      const target = HOLE;
      const img = new Image();
      img.onload = () => { if (HOLE === target) { HOLE._img = processAerial(img); HOLE._imgReady = true; } };
      img.src = "courses/" + src.aerial.file;
    }
    HOLE._mask = null;
    const target = HOLE;
    loadSurfaceMask(src.surfaceMask, (m) => { if (HOLE === target) HOLE._mask = m; });
  }
  // Boundary-OB only where the OSM boundary actually covers the hole. If the
  // tee->pin line is largely outside it (mapping gap, e.g. a multi-parcel course
  // missing a hole), drop boundary-OB for this hole and fall back to the mask —
  // better than playing the whole hole as out of bounds.
  if (HOLE._boundary) {
    const t = HOLE.teePos, p = HOLE.holePos, N = 20; let outside = 0;
    for (let i = 0; i <= N; i++) {
      const x = t.x + (p.x - t.x) * i / N, y = t.y + (p.y - t.y) * i / N;
      if (!inAnyPoly(x, y, HOLE._boundary)) outside++;
    }
    if (outside > N * 0.4) HOLE._boundary = null;
  }
  WORLD.w = src.world.w;
  WORLD.h = src.world.h;
  // green speed -> deceleration -> putt cap; then refresh power for this scale.
  TUNE.greenDecel = GREEN_DECEL_K / HOLE.greenSpeed;
  recalcPower();

  resetState();
  resetChipSpin();  // re-center the chip spin slider to neutral for the new hole
  // New wind each hole (no wind on driving range)
  if (!HOLE.isRange && windEnabled) {
    wind.dir   = Math.random() * Math.PI * 2;
    wind.speed = Math.random() < 0.1 ? Math.floor(Math.random() * 2)  // 10% calm (0-1 mph)
                                     : Math.round(Math.random() * 8) + 2; // 2-10 mph
  } else {
    wind.speed = 0;
  }
  autoClubEnabled = !!activeSettings.autoClub; // honor the round's default each new hole
  manualClubThisShot = false; // fresh hole starts clean (no carried-over override)
  autoClub(); // tee club for the hole length (range lets the player choose)
  // rotate the camera so this hole's tee->pin points up the screen (plays "up"
  // even though the global map is north-up and holes face different ways).
  const alpha = Math.atan2(HOLE.holePos.y - HOLE.teePos.y, HOLE.holePos.x - HOLE.teePos.x);
  camera.tAngle = -Math.PI / 2 - alpha;
  camera.angle = camera.tAngle; cameraAiming = false; // instant orient on hole change
  frameTarget();
  holeFitW = camera._w; holeFitH = camera._h;          // full-hole fit -> refScale
  camera.focus = { x: camera.tFocus.x, y: camera.tFocus.y }; // snap, no ease-in
  camera.scale = camera.tScale;
  applyDeviceMode(); // set body class + IS_DESKTOP before first framing
  resize();
  applyHudPositions(); // restore any player-dragged HUD panels (mobile)
  updateScorecard();
  if (matchLive() && !HOLE.isRange) pushMatchShot({ cur_strokes: 0 });  // new hole, ball on tee
  elResult.classList.add("hidden");
  // Swing hint: only ever on hole 1's tee shot (see positionHint/hideHint).
  // Range/preview/hole-select callers hide it again right after setHole()
  // returns, since HOLE.isRange etc. aren't set until then.
  if (round.holesPlayed === 0) {
    elHint.classList.remove("hidden");
    positionHint();
  }
  if (!HOLE.isRange) maybeShowOnboarding();
  update3DMode();
}

// First-run "How to play" card — shown once, the first time a player reaches a
// real hole (localStorage golf.onboarded). Plugs the drop-in learning gap without
// nagging returning players. Wired to its own dismiss button at boot.
function maybeShowOnboarding() {
  if (lsGet("golf.onboarded", false)) return;
  const ov = document.getElementById("onboarding");
  if (ov) ov.classList.remove("hidden");
}
(function wireOnboarding() {
  const ov = document.getElementById("onboarding");
  const done = document.getElementById("ob-got");
  const dismiss = () => { if (ov) ov.classList.add("hidden"); lsSet("golf.onboarded", true); };
  if (done) done.addEventListener("click", dismiss);
  if (ov) ov.addEventListener("click", (e) => { if (e.target === ov) dismiss(); });
})();

// Hardcoded fallback (offline / file:// or fetch failure): a simple par 4.
function circlePoly(cx, cy, r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}
const FALLBACK_HOLE = {
  num: 1, par: 4, yards: 450, world: { w: 100, h: 180 },
  tee: { x: 50, y: 165 }, pin: { x: 52, y: 22 }, greenSpeed: 20,
  surfaces: {
    green: [circlePoly(52, 22, 16, 28)],
    fairway: [[
      { x: 38, y: 168 }, { x: 62, y: 168 }, { x: 66, y: 110 }, { x: 70, y: 60 },
      { x: 64, y: 40 }, { x: 40, y: 40 }, { x: 34, y: 60 }, { x: 32, y: 110 },
    ]],
    bunker: [],
    water: [[{ x: 70, y: 95 }, { x: 88, y: 95 }, { x: 88, y: 55 }, { x: 72, y: 58 }]],
    tee: [],
  },
};

async function loadCourse(id) {
  // no-cache (revalidate), matching the manifest fetch: WKWebView otherwise
  // serves a stale course JSON indefinitely after a re-bake — tee/pin/DEM
  // edits silently never reach the app (same failure mode as the game.js
  // ?v= story, but for data).
  const res = await fetch("courses/" + id + ".json", { cache: "no-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  course = await res.json();
  YARDS_PER_UNIT = course.yardsPerUnit || YARDS_PER_UNIT;
  course._greens = null; course._img = undefined; course._imgReady = false; // shared caches
  course._mask = undefined;
  holeIndex = 0;
  setHole(course.holes[holeIndex]);
}

// Selectable courses (baked under courses/<id>.json). The live list comes from
// courses/manifest.json (loadManifest); this hardcoded set is the fallback if the
// manifest is missing. First is the default.
const FALLBACK_COURSES = [
  { id: "pinehurst-no2", name: "Pinehurst No. 2", sub: "Pinehurst, NC · Par 70", aerial: "naip" },
  { id: "four-oaks-dracut", name: "Four Oaks Country Club", sub: "Dracut, MA · Par 70", aerial: "naip" },
  { id: "tpc-river-highlands", name: "TPC River Highlands", sub: "Cromwell, CT · Par 70", aerial: "naip" },
  { id: "st-andrews-old", name: "St Andrews — Old Course", sub: "St Andrews, Scotland · Par 72", aerial: "esri" },
  { id: "bethpage-black", name: "Bethpage Black", sub: "Farmingdale, NY · Par 71", aerial: "naip" },
];
let COURSES = FALLBACK_COURSES.slice();

let selectedCourseId = COURSES[0].id;
// Replace COURSES from courses/manifest.json (admin bakes append to it). Falls
// back silently to FALLBACK_COURSES on any error so the menu always works.
async function loadManifest() {
  try {
    const res = await fetch("courses/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const arr = await res.json();
    if (Array.isArray(arr) && arr.length) COURSES = arr;
  } catch (e) { console.warn("manifest load failed, using fallback courses:", e); }
  if (!COURSES.some((c) => c.id === selectedCourseId)) selectedCourseId = COURSES[0].id;
}

// ---------------------------------------------------------------------
//  Course unlock progression — mirror of the bot ladder's botUnlocked().
//  Nothing stores an "unlocked list": state derives live from golf.botsBeaten
//  + golf.milestones + golf.entitlements, so it can't drift and needs no
//  migration. golf.entitlements is the future paid seam — hydrate it from a
//  server entitlements table (like _profile) and purchases just work.
// ---------------------------------------------------------------------
const FREE_COURSE_IDS = FALLBACK_COURSES.map((c) => c.id); // offline fallback must stay playable
// Admin-only courses: excluded from every picker/pool/random-rotation and
// blocked outright in courseUnlocked() for non-admins (real access control,
// not just UI declutter — a stale selectedCourseId can't sneak a player in).
const HIDDEN_COURSE_IDS = new Set(["four-oaks-dracut"]);
function visibleCourses() {
  return isTournamentAdmin() ? COURSES : COURSES.filter((c) => !HIDDEN_COURSE_IDS.has(c.id));
}
// Marquee courses earned by deed, not ladder position.
const ACHIEVEMENT_COURSES = {
  "pebble-beach-golf-course":   { milestone: "first-ace", label: "Make a hole-in-one" },
  "augusta-national-golf-club": { milestone: "break-par", label: "Break par in an 18-hole round" },
  "blackwater-vale":            { milestone: "match-win", label: "Win a quick match" },
};
// Fixed chunk size (NOT count/14): manifest order is append-only, so a fixed
// size means existing courses never change tier as the list grows — new bakes
// land in the last tier.
const TIER_SIZE = 7;

let _tierMap = null, _tierSrc = null;
function courseTierMap() {           // Map(courseId -> bot tier index)
  if (_tierMap && _tierSrc === COURSES) return _tierMap;
  const m = new Map();
  let i = 0;
  for (const c of COURSES) {
    if (FREE_COURSE_IDS.includes(c.id) || ACHIEVEMENT_COURSES[c.id]) continue;
    m.set(c.id, Math.min(Math.floor(i / TIER_SIZE), BOTS.length - 1));
    i++;
  }
  _tierMap = m; _tierSrc = COURSES;
  return m;
}

function getEntitlements() { return lsGet("golf.entitlements", { v: 1, courses: {} }); }
function purchasedCourse(id) { return !!getEntitlements().courses[id]; }

// Single source of truth for "what does it take to play this course".
function unlockReq(id) {
  if (FREE_COURSE_IDS.includes(id)) return { type: "free", label: "", met: true };
  const ach = ACHIEVEMENT_COURSES[id];
  if (ach) return { type: "milestone", milestoneId: ach.milestone, label: ach.label,
                    met: !!getMilestones()[ach.milestone] };
  const t = courseTierMap().get(id);
  if (t == null) return { type: "free", label: "", met: true };  // unknown id — never brick a course
  return { type: "bot", botId: BOTS[t].id, label: "Beat " + BOTS[t].name, met: botBeaten(BOTS[t].id) };
}
function courseUnlocked(id) {
  if (id === "butter-brook-golf-club") return true; // TEMP debug: Apple 3D POC testing, revert before shipping
  if (HIDDEN_COURSE_IDS.has(id)) return isTournamentAdmin();
  return isTournamentAdmin() || purchasedCourse(id) || isDailyFeatured(id) ||
         isTourFeatured(id) || unlockReq(id).met;
}
// This week's real PGA Tour venue plays free (a taste, like the daily featured
// course) — set when the Live PGA Tour panel matches the event to a baked course.
function isTourFeatured(id) { return !!id && id === _tourCourseId; }
function unlockedCourseIds() { return visibleCourses().filter((c) => courseUnlocked(c.id)).map((c) => c.id); }
function courseUnlockCount() {
  const vis = visibleCourses();
  return { unlocked: vis.filter((c) => courseUnlocked(c.id)).length, total: vis.length };
}

// A course record is "real" (bookable) unless it's a fictional Original or a
// dev imagery-test entry — those have no real-world tee sheet to book.
function courseIsReal(id) {
  const c = COURSES.find((x) => x.id === id);
  if (!c) return true;   // unknown id — never hide the CTA over a lookup miss
  return c.region !== "Originals" && c.region !== "Imagery test";
}

// Booking confirmed a real-world tee time -> unlock that course, permanently,
// via the same golf.entitlements bucket the future paid seam already uses
// (PRODUCT_STRATEGY.md §4). Optimistic local write; the booking-engine Edge
// Function mirrors it server-side (profiles.entitlements) for logged-in users
// so the unlock follows them across devices.
function unlockCourseFromBooking(courseId, bookingId) {
  const ent = getEntitlements();
  ent.courses = ent.courses || {};
  ent.courses[courseId] = { via: "booking", bookingId: bookingId || null, at: Date.now() };
  lsSet("golf.entitlements", ent);
  track("course_unlocked", { course: courseId, via: "booking" });
}

// Pull in any server-side entitlements (booked from another device) without
// ever dropping locally-earned ones — union merge, local wins on conflict.
function mergeServerEntitlements(serverEnt) {
  if (!serverEnt || !serverEnt.courses) return;
  const ent = getEntitlements();
  ent.courses = ent.courses || {};
  let changed = false;
  for (const cid in serverEnt.courses) {
    if (!ent.courses[cid]) { ent.courses[cid] = serverEnt.courses[cid]; changed = true; }
  }
  if (changed) lsSet("golf.entitlements", ent);
}

// ---------------------------------------------------------------------
//  Booking — "book a real tee time -> unlock that course" (PRODUCT_STRATEGY.md
//  §4). Client never talks to a provider directly (secrets stay server-side);
//  it calls the booking-engine Supabase Edge Function, which fans out across
//  providers (mock display-only today; GolfNow/Lightspeed behind a flag once
//  credentialed — see supabase/functions/booking-engine/index.ts). If the
//  function isn't deployed yet (dev, or before the Supabase side is set up),
//  BOOKING_FN fetch fails and callers fall back to a local mock so the CTA is
//  fully testable without any deploy.
// ---------------------------------------------------------------------
function bookingFnUrl() { return LB_URL + "/functions/v1/booking-engine"; }   // LB_URL is declared later in this file — resolve lazily

function localMockTeeTimes(courseId, courseName, location) {
  const q = encodeURIComponent(`book tee time ${courseName}${location ? " " + location : ""}`);
  const base = new Date();
  return [7, 8, 9.5, 11, 13, 14.5, 16].map((h, i) => {
    const t = new Date(base);
    t.setHours(Math.floor(h), (h % 1) * 60, 0, 0);
    if (t < base) t.setDate(t.getDate() + 1);
    return {
      id: `mock-${courseId}-${i}`, provider: "mock", courseId, courseName,
      time: t.toISOString(), players: 4, priceCents: null,
      bookable: false, deepLink: `https://www.google.com/search?q=${q}`,
    };
  });
}

async function searchTeeTimes(courseId, courseName, location) {
  track("teetimes_viewed", { course: courseId });
  try {
    const res = await fetch(bookingFnUrl(), {
      method: "POST", headers: { "Content-Type": "application/json", apikey: LB_KEY, Authorization: "Bearer " + LB_KEY },
      body: JSON.stringify({ action: "search", courseId, courseName, location }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (Array.isArray(data.teeTimes) && data.teeTimes.length) return data.teeTimes;
    throw new Error("empty");
  } catch (e) {
    return localMockTeeTimes(courseId, courseName, location);   // booking-engine not deployed yet / offline
  }
}

// Deep-link-only tee time (bookable:false, the mock/scrape path today): just
// track + open, and count it as an unlock — the golfer's intent to book
// through the game is the value exchange, not us watching them complete a
// checkout on someone else's site.
async function bookTeeTime(teeTime) {
  track("booking_started", { course: teeTime.courseId, provider: teeTime.provider });
  if (!teeTime.bookable) {
    if (teeTime.deepLink) window.open(teeTime.deepLink, "_blank", "noopener");
    track("booking_redirected", { course: teeTime.courseId, provider: teeTime.provider });
    unlockCourseFromBooking(teeTime.courseId, null);
    return { ok: true, redirected: true };
  }
  try {
    const u = currentUser();
    const res = await fetch(bookingFnUrl(), {
      method: "POST", headers: { "Content-Type": "application/json", apikey: LB_KEY, Authorization: "Bearer " + LB_KEY },
      body: JSON.stringify({ action: "book", teeTime, player: { name: getPlayerName() || "Guest" }, userId: u ? u.id : null }),
    });
    const data = await res.json();
    if (data.ok) {
      track("booking_confirmed", { course: teeTime.courseId, provider: teeTime.provider });
      unlockCourseFromBooking(teeTime.courseId, data.bookingId);
      return { ok: true };
    }
    track("booking_failed", { course: teeTime.courseId, provider: teeTime.provider, reason: data.reason });
    return { ok: false, reason: data.reason };
  } catch (e) {
    track("booking_failed", { course: teeTime.courseId, provider: teeTime.provider, reason: "network" });
    return { ok: false, reason: "network error" };
  }
}

// Non-blocking, dismissible booking sheet — opened from the round-end CTA.
async function openBookSheet(courseId) {
  const c = COURSES.find((x) => x.id === courseId);
  const name = c ? c.name : courseId;
  const location = c ? c.location : "";
  document.getElementById("bk-course-name").textContent = name;
  const list = document.getElementById("bk-list");
  list.innerHTML = `<div class="bk-loading">Finding tee times…</div>`;
  document.getElementById("book-sheet").classList.remove("hidden");
  const teeTimes = await searchTeeTimes(courseId, name, location);
  if (!teeTimes.length) { list.innerHTML = `<div class="bk-loading">No tee times found right now.</div>`; return; }
  list.innerHTML = teeTimes.map((t, i) => {
    const time = new Date(t.time).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
    const price = t.priceCents != null ? `$${(t.priceCents / 100).toFixed(0)}` : "";
    const label = t.bookable ? "Book" : "View";
    return `<button class="bk-row" data-i="${i}"><span class="bk-time">${esc(time)}</span>` +
           `<span class="bk-meta">${t.players} players${price ? " · " + price : ""}</span>` +
           `<span class="bk-go">${label}</span></button>`;
  }).join("");
  list.querySelectorAll(".bk-row").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const t = teeTimes[+btn.dataset.i];
      btn.disabled = true; btn.querySelector(".bk-go").textContent = "…";
      const res = await bookTeeTime(t);
      if (res.ok) {
        showToast(t.bookable ? "Tee time booked — course unlocked!" : "Course unlocked!", 2600, "gold");
        closeBookSheet();
      } else {
        btn.disabled = false; btn.querySelector(".bk-go").textContent = label_(t);
        showToast(res.reason || "Couldn't book — try again.", 2200);
      }
    });
  });
  function label_(t) { return t.bookable ? "Book" : "View"; }
}
function closeBookSheet() { document.getElementById("book-sheet").classList.add("hidden"); }

// ---------------------------------------------------------------------
//  Course-select page: search + filter rail + card grid
// ---------------------------------------------------------------------
const elCourseSelect = document.getElementById("course-select");
const elCsGrid = document.getElementById("cs-grid");
const elCsFilters = document.getElementById("cs-filters");
const elCsSearch = document.getElementById("cs-search");
const elCsCount = document.getElementById("cs-count");

// Active filter: {type:"all"} | {type:"tag",value} | {type:"region",value}
let courseFilter = { type: "all" };
const FILTER_TAGS = [
  { value: "pgaTour", label: "PGA Tour" },
  { value: "major", label: "Major venues" },
];

function courseImg(id) { return "courses/img/" + id + "/course.jpg"; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function courseMatchesFilter(c) {
  if (courseFilter.type === "tag") return (c.tags || []).includes(courseFilter.value);
  if (courseFilter.type === "region") return c.region === courseFilter.value;
  return true;
}
function courseMatchesSearch(c, q) {
  if (!q) return true;
  return (c.name + " " + (c.location || "") + " " + (c.sub || "")).toLowerCase().includes(q);
}

function buildFilterRail() {
  if (!elCsFilters) return;
  const vis = visibleCourses();
  const regions = [...new Set(vis.map((c) => c.region).filter(Boolean))]
    .sort((a, b) => vis.filter((c) => c.region === b).length - vis.filter((c) => c.region === a).length);
  let html = `<div class="cs-fgroup"><div class="cs-fgroup-title">Show</div>`;
  html += `<button class="cs-chip" data-ft="all">All<span class="cs-chip-n">${vis.length}</span></button></div>`;
  html += `<div class="cs-fgroup"><div class="cs-fgroup-title">Featured</div>`;
  for (const t of FILTER_TAGS) {
    const n = vis.filter((c) => (c.tags || []).includes(t.value)).length;
    if (!n) continue;
    html += `<button class="cs-chip" data-ft="tag" data-fv="${t.value}">${t.label}<span class="cs-chip-n">${n}</span></button>`;
  }
  html += `</div><div class="cs-fgroup"><div class="cs-fgroup-title">Region</div>`;
  for (const r of regions) {
    const n = vis.filter((c) => c.region === r).length;
    html += `<button class="cs-chip" data-ft="region" data-fv="${esc(r)}">${esc(r)}<span class="cs-chip-n">${n}</span></button>`;
  }
  html += `</div>`;
  elCsFilters.innerHTML = html;
  elCsFilters.querySelectorAll(".cs-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const ft = chip.dataset.ft;
      courseFilter = ft === "all" ? { type: "all" } : { type: ft, value: chip.dataset.fv };
      renderCourseCards();
    });
  });
}

function renderCourseCards() {
  if (!elCsGrid) return;
  const q = (elCsSearch && elCsSearch.value || "").trim().toLowerCase();
  const list = visibleCourses().filter((c) => courseMatchesFilter(c) && courseMatchesSearch(c, q));
  // sync active chip
  if (elCsFilters) elCsFilters.querySelectorAll(".cs-chip").forEach((chip) => {
    const on = courseFilter.type === "all" ? chip.dataset.ft === "all"
      : chip.dataset.ft === courseFilter.type && chip.dataset.fv === courseFilter.value;
    chip.classList.toggle("active", on);
  });
  if (elCsCount) {
    const uc = courseUnlockCount();
    elCsCount.textContent = list.length + (list.length === 1 ? " course" : " courses") +
      " · " + uc.unlocked + " unlocked";
  }
  if (!list.length) { elCsGrid.innerHTML = `<div class="cs-empty">No courses match.</div>`; return; }
  // Unlocked courses first (stable partition — manifest order kept within each group).
  const ordered = [...list.filter((c) => courseUnlocked(c.id)), ...list.filter((c) => !courseUnlocked(c.id))];
  const frag = document.createDocumentFragment();
  for (const c of ordered) {
    const locked = !courseUnlocked(c.id);
    const req = unlockReq(c.id);
    const featured = isDailyFeatured(c.id);
    const card = document.createElement("div");
    card.className = "cs-card" + (locked ? " cs-card--locked" : "");
    const best = courseBest(c.id);
    const bestBadge = best ? `<span class="cs-card-best">Best ${formatToPar(best.toPar)}</span>` : "";
    const tags = c.tags || [];
    let badges = "";
    if (featured && !isTournamentAdmin()) badges += `<span class="cs-badge featured">Free today</span>`;
    if (tags.includes("pgaTour")) badges += `<span class="cs-badge pga">PGA Tour</span>`;
    if (tags.includes("major")) badges += `<span class="cs-badge major">Major</span>`;
    // Four Oaks 3D (three.js) is WIP — still hidden from the public picker via
    // HIDDEN_COURSE_IDS (only admins reach this card at all, see
    // visibleCourses()). This toggle replaces the dev-only `?3d=1` URL param
    // as the real entry point; render3DWanted() (top of file) already reads
    // this same localStorage key every frame, so flipping it takes effect
    // immediately, no reload needed.
    const is3D = c.id === "four-oaks-dracut";
    if (is3D) {
      const on = lsGet("golf.render3D", false);
      badges += `<span class="cs-badge cs-badge-3d${on ? " on" : ""}" data-three-d-toggle>${on ? "3D ✓" : "Play in 3D"}</span>`;
    }
    const par = c.par != null ? c.par : "—";
    const yds = c.yards ? c.yards.toLocaleString() + " yds" : "";
    const loc = c.location && c.location !== "Unknown" ? esc(c.location) : "";
    const meta = [loc, "Par " + par, yds].filter(Boolean).join(" · ");
    const btns = locked
      ? `<span class="cs-req"><span class="ic ic-lock"></span>${esc(req.label)}</span>` +
        `<button class="cs-preview">Preview</button>`
      : `<button class="cs-play">Play</button>` +
        `<button class="cs-preview">Preview</button>`;
    card.innerHTML =
      `<div class="cs-card-img">` +
        `<div class="cs-card-badges">${badges}</div>${bestBadge}` +
        (locked ? `<span class="cs-lock-ic"><span class="ic ic-lock"></span></span>` : "") +
        `<img loading="lazy" src="${courseImg(c.id)}" alt="" onerror="this.style.display='none'">` +
      `</div>` +
      `<div class="cs-card-body">` +
        `<div class="cs-card-name">${esc(c.name)}</div>` +
        `<div class="cs-card-meta">${meta}</div>` +
        `<div class="cs-card-btns">${btns}</div>` +
      `</div>`;
    const play = card.querySelector(".cs-play");
    if (play) play.addEventListener("click", () => { selectedCourseId = c.id; startCourse(); });
    card.querySelector(".cs-preview").addEventListener("click", () => openPreview(c.id));
    if (is3D) {
      const toggle = card.querySelector("[data-three-d-toggle]");
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        lsSet("golf.render3D", !lsGet("golf.render3D", false));
        renderCourseCards(); // re-render so the badge label/state reflects the flip immediately
      });
    }
    frag.appendChild(card);
  }
  elCsGrid.innerHTML = "";
  elCsGrid.appendChild(frag);
}

// Kept for legacy call sites (boot, manifest refresh, post-bake): rebuild the
// filter rail + grid from the current COURSES list.
function buildCourseList() { buildFilterRail(); renderCourseCards(); }

function showCourseSelect() {
  mode = "select";
  elMenu.classList.add("hidden");
  elCourseSelect.classList.remove("hidden");
  // Context strip: make it obvious when the pick is for a configured match.
  const ctx = document.getElementById("cs-context");
  if (ctx) {
    if (matchSetupMode) {
      const ov = document.getElementById("match-setup");
      const fmt = ov && ov.dataset.format === "match" ? "Match play" : "Stroke play";
      const holes = (ov && ov.dataset.holes) || "18";
      ctx.textContent = `Pick the course for your match · ${fmt} · ${holes} holes`;
      ctx.classList.remove("hidden");
    } else if (botCoursePickMode) {
      const ov = document.getElementById("bot-select");
      ctx.textContent = `Pick the course for your bot match · ${(ov && ov.dataset.holes) || "9"} holes`;
      ctx.classList.remove("hidden");
    } else {
      ctx.classList.add("hidden");
    }
  }
  buildFilterRail();
  renderCourseCards();
}
function hideCourseSelect() { elCourseSelect.classList.add("hidden"); }

if (elCsSearch) {
  let _csSearchDebounce = null;
  elCsSearch.addEventListener("input", () => {
    clearTimeout(_csSearchDebounce);
    _csSearchDebounce = setTimeout(renderCourseCards, 150); // avoid rebuilding all ~100 cards per keystroke
  });
}
document.getElementById("cs-back").addEventListener("click", () => {
  hideCourseSelect();
  // Host picking a course for a match → back returns to the settings step.
  if (matchSetupMode) { matchSetupMode = false; openMatchSetup(true); return; }
  // Picking for a bot match → back returns to the roster, choice unchanged.
  if (botCoursePickMode) { botCoursePickMode = false; openBotSelect(); return; }
  showMenu();
});

// ---------------------------------------------------------------------
//  Hole preview — Trackman/EA-style flyover reusing the live canvas
// ---------------------------------------------------------------------
const elPreview = document.getElementById("preview");
let previewIdx = 0;

async function openPreview(id) {
  hideCourseSelect();
  elPreview.classList.remove("hidden");
  mode = "preview";
  elHudBtn.classList.add("hidden");
  elHmClubRow.classList.add("hidden");
  elStats.classList.add("hidden");
  elScorecard.style.display = "none";
  if (elHint) elHint.classList.add("hidden");
  try {
    if (!course || course.id !== id) await loadCourse(id); // sets course + hole 0
  } catch (e) { console.warn("preview load failed:", e); }
  previewIdx = 0;
  const meta = COURSES.find((c) => c.id === id);
  document.getElementById("pv-course").textContent = (meta && meta.name) || (course && course.name) || id;
  showPreviewHole();
}

function showPreviewHole() {
  if (!course || !course.holes || !course.holes.length) return;
  const n = course.holes.length;
  previewIdx = Math.max(0, Math.min(previewIdx, n - 1));
  setHole(course.holes[previewIdx]);
  if (elHint) elHint.classList.add("hidden"); // setHole re-shows the swing hint
  const h = course.holes[previewIdx];
  document.getElementById("pv-hole").textContent = "Hole " + (h.num || previewIdx + 1) + " / " + n;
  const si = h.si != null ? " · SI " + h.si : "";
  document.getElementById("pv-stats").innerHTML =
    "Par <b>" + h.par + "</b> · <b>" + (h.yards || HOLE.yards || "?") + "</b> yds" + si;
  // dots
  const dots = document.getElementById("pv-dots");
  dots.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const d = document.createElement("span");
    d.className = "pv-dot" + (i === previewIdx ? " active" : "");
    d.addEventListener("click", () => { previewIdx = i; showPreviewHole(); });
    dots.appendChild(d);
  }
  document.getElementById("pv-prev").disabled = previewIdx <= 0;
  document.getElementById("pv-next").disabled = previewIdx >= n - 1;
  // Frame the WHOLE hole so the teebox and the green/pin both stay on screen.
  // (setHole already fit tee<->pin at the midpoint; ease the zoom in for a
  // gentle cinematic settle instead of panning one end off the frame.)
  const mid = { x: (HOLE.teePos.x + HOLE.holePos.x) / 2,
                y: (HOLE.teePos.y + HOLE.holePos.y) / 2 };
  camera.focus = { x: mid.x, y: mid.y };
  camera.tFocus = { x: mid.x, y: mid.y };
  camera.scale = camera.tScale * 0.82;  // start a touch wide, ease to full fit
}

function closePreview() {
  elPreview.classList.add("hidden");
  showCourseSelect();
}

document.getElementById("pv-close").addEventListener("click", closePreview);
document.getElementById("pv-prev").addEventListener("click", () => { previewIdx--; showPreviewHole(); });
document.getElementById("pv-next").addEventListener("click", () => { previewIdx++; showPreviewHole(); });
document.getElementById("pv-play").addEventListener("click", () => {
  if (course && !courseUnlocked(course.id)) {
    showToast("Locked — " + unlockReq(course.id).label, 2400);
    return;
  }
  if (course) selectedCourseId = course.id;
  elPreview.classList.add("hidden");
  startCourse();
});

// =====================================================================
//  Menu, driving range & shot-stats HUD
// =====================================================================
const elMenu = document.getElementById("menu");
const elStats = document.getElementById("stats");
const elRangeUI = document.getElementById("range-ui");
const elScorecard = document.getElementById("scorecard");
const rangeSlider = document.getElementById("range-slider");
const elRangeYards = document.getElementById("range-yards");
const elRangeResult = document.getElementById("range-result");
const stLie = document.getElementById("st-lie");
const stLieNote = document.getElementById("st-lie-note");
const stCarry = document.getElementById("st-carry");
const stTotal = document.getElementById("st-total");
const stSpeed = document.getElementById("st-speed");
const stPin = document.getElementById("st-pin");
const stPlays = document.getElementById("st-plays");
const rowPlays = document.getElementById("st-plays-row");
const stLieFx = document.getElementById("st-lie-fx");
const rowLieFx = document.getElementById("st-lie-fx-row");
const rowCarry = stCarry.parentElement;
const elWindChip = document.getElementById("wind-chip");
const elWindArrow = document.getElementById("wind-arrow");
const elWindMph = document.getElementById("wind-mph");
let _windMphShown = null;
let _windAngShown = null;

// Wind readout as a DOM chip in the top HUD card. The arrow rotates with the
// camera (same projection the old canvas pill used). Gating matches the old
// drawWindIndicator: course mode, not range, wind actually blowing.
function updateWindChip() {
  if (!elWindChip) return;
  if (!HOLE || HOLE.isRange || mode !== "course" || wind.speed < 1) {
    elWindChip.classList.add("hidden");
    return;
  }
  elWindChip.classList.remove("hidden");
  // wind push vector (FROM dir → pushes opposite), projected to screen via view
  const pwx = -Math.sin(wind.dir), pwy = Math.cos(wind.dir);
  const svx = view.a * pwx + view.b * pwy;
  const svy = view.d * pwx + view.e * pwy;
  const ang = Math.atan2(svy, svx);
  if (_windAngShown === null || Math.abs(ang - _windAngShown) > 1e-3) {
    elWindArrow.style.transform = "rotate(" + ang + "rad)";
    _windAngShown = ang;
  }
  const spd = Math.round(wind.speed);
  if (spd !== _windMphShown) { elWindMph.textContent = spd + " mph"; _windMphShown = spd; }
}

function rangeFeedback(msg) { if (elRangeResult) elRangeResult.textContent = msg; }

// Human label for the ball's current lie (Tee/Fairway/Rough/Sand/...).
const LIE_NAMES = { fairway: "Fairway", green: "Green", bunker: "Sand",
                    water: "Water", woods: "Trees", rough: "Rough", tee: "Tee" };
function lieLabel() {
  const b = state.ball;
  if (!HOLE.isRange &&
      (state.strokes === 0 || inAnyPoly(b.x, b.y, HOLE.surfaces.tee) ||
       dist(b.x, b.y, HOLE.teePos.x, HOLE.teePos.y) < 4)) return "Tee";
  return LIE_NAMES[surfaceAt(b.x, b.y)] || "Rough";
}
// Note under the lie. Distance is unaffected for now (every shot plays full), so
// this just flags the real hazards (water/trees penalty); other lies = no note.
function lieNote(label) {
  switch (label) {
    case "Green": return "Putting surface";
    case "Trees": return "Out of bounds · +1 penalty";
    case "Water": return "Water hazard · +1 penalty";
    default: return "";
  }
}

// Launch speed (units/frame) -> a believable ball speed, calibrated so a full
// swing reads ~175 mph (tour driver) and scales down with power.

// Shot stats HUD. Yards normally; feet (carry omitted) once on the green.
// Dirty-checked: everything read below (mode/moving/ball pos/club/sliders/shot)
// is idle almost all the time the ball is at rest, but this used to run in full
// — including surfaceAt/playsLikeYards poly hit-tests and ~8 DOM writes — every
// single frame via loop(), 60x/sec, regardless of whether any of it changed.
let _statsSig = null;
function updateStats() {
  const b0 = state.ball;
  const sig = mode + "|" + (state.moving ? 1 : 0) + "|" + (state.inHole ? 1 : 0) + "|" +
    Math.round(b0.x * 100) + "|" + Math.round(b0.y * 100) + "|" +
    (HOLE ? HOLE.num : -1) + "|" + selectedClub + "|" + flightBias + "|" + chipSpinBias + "|" +
    (lieEffectEnabled ? 1 : 0) + "|" + (chipEnabled ? 1 : 0) + "|" +
    shot.mph + "|" + shot.carry + "|" + shot.total;
  if (sig === _statsSig) return;
  _statsSig = sig;
  // Gutter slider (SPIN greenside / FLIGHT on full shots): shown only with the ball
  // at rest off the green (so it never blocks a swing-in-progress). Off in menu/range.
  syncSpinSlider();
  if (mode !== "course" && mode !== "range") { elStats.classList.add("hidden"); return; }
  // Hide the stats panel while the ball is in motion so it doesn't cover the
  // hole/ball during a shot; it returns once the ball settles.
  if (state.moving) { elStats.classList.add("hidden"); return; }
  elStats.classList.remove("hidden");
  updateClubUI();
  const lie = lieLabel();
  stLie.textContent = lie;
  stLieNote.textContent = lieNote(lie);
  const b = state.ball;
  const onGreen = !HOLE.isRange && surfaceAt(b.x, b.y) === "green";
  // Lie effect: how the current lie scales the next full shot's power + backspin. Hidden
  // when on the green (putting) or when the lie is clean (no penalty).
  const surf = HOLE.isRange ? "tee" : surfaceAt(b.x, b.y);
  const lm = TUNE.lie[surf] ?? 1, sm = TUNE.lieSpin[surf] ?? 1;
  if (!lieEffectEnabled || onGreen || (lm === 1 && sm === 1)) {
    rowLieFx.style.display = "none";
  } else {
    rowLieFx.style.display = "";
    const dp = Math.round((lm - 1) * 100), ds = Math.round((sm - 1) * 100);
    stLieFx.textContent = `${dp}% pwr · ${ds}% spin`;
  }
  const toPin = dist(b.x, b.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT;
  const spd = shot.mph ? shot.mph + " mph" : "—";
  if (onGreen) {
    rowCarry.style.display = "none";                       // putting: feet, no carry
    stTotal.textContent = shot.total != null ? Math.round(shot.total * 3) + " ft" : "—";
    stSpeed.textContent = spd;
    stPin.textContent = Math.round(toPin * 3) + " ft";
    rowPlays.style.display = "none";                        // no elevation play on the green
  } else {
    rowCarry.style.display = "";
    stCarry.textContent = shot.carry != null ? Math.round(shot.carry) + " yds" : "—";
    stTotal.textContent = shot.total != null ? Math.round(shot.total) + " yds" : "—";
    stSpeed.textContent = spd;
    // To pin = straight-line yards. Plays = the elevation-adjusted caddie number,
    // shown on its own row only when the climb to the pin is meaningful (≥3 ft).
    stPin.textContent = Math.round(toPin) + " yds";
    const pl = playsLikeYards(b.x, b.y);
    if (pl.dz != null && Math.abs(pl.dz) >= 3) {
      rowPlays.style.display = "";
      const ft = Math.round(pl.dz);
      stPlays.textContent = `${Math.round(pl.plays)} yds (${ft > 0 ? "+" : ""}${ft} ft)`;
    } else {
      rowPlays.style.display = "none";
    }
  }
}

// Synthetic driving range: a long turf strip, tee at the bottom, a target ring
// `targetYds` up the range. No cup, no hazards.
function buildRangeRec(targetYds) {
  const ypu = YARDS_PER_UNIT;
  const w = 54, h = 300 / ypu + 28;     // fits up to a 300-yd target + margin
  const cx = w / 2, teeY = h - 12;
  const tgtY = teeY - targetYds / ypu;
  return {
    num: 1, par: 0, yards: targetYds, world: { w, h },
    tee: { x: cx, y: teeY }, pin: { x: cx, y: tgtY }, aerial: null,
    surfaces: {
      fairway: [[{ x: cx - 10, y: teeY + 4 }, { x: cx + 10, y: teeY + 4 },
                 { x: cx + 8, y: 6 }, { x: cx - 8, y: 6 }]],
      tee: [[{ x: cx - 2, y: teeY + 2 }, { x: cx + 2, y: teeY + 2 },
             { x: cx + 2, y: teeY - 2 }, { x: cx - 2, y: teeY - 2 }]],
      green: [], bunker: [], water: [], grass: [], woods: [], cartpath: [],
    },
  };
}

// Fixed range camera (angle 0): frame the tee and the target together.
function frameRange() {
  const t = HOLE.teePos, p = HOLE.holePos, pad = 8;
  const w = Math.abs(t.x - p.x) + 2 * pad, h = Math.abs(t.y - p.y) + 2 * pad;
  camera.tAngle = 0;
  camera._w = w; camera._h = h;
  camera.tScale = Math.min(window.innerWidth / w, window.innerHeight / h);
  camera.tFocus = { x: (t.x + p.x) / 2, y: (t.y + p.y) / 2 };
}

const elCourseMenu = document.getElementById("course-menu");
const elHoleGrid = document.getElementById("hole-grid");
const elHudBtn = document.getElementById("hud-btn");
const elHudMenu = document.getElementById("hud-menu");
const elHmCourseItems = document.getElementById("hm-course-items");
const elHmClubRow = document.getElementById("hm-club-row");
const elClubName = document.getElementById("hm-club-name");
const elClubYds = document.getElementById("hm-club-yds");
const elMeasureBtn = document.getElementById("hm-measure");
const elSlopeBtn = document.getElementById("hm-slope");
const elArrowsBtn = document.getElementById("hm-arrows");
elArrowsBtn.classList.toggle("active", breakArrows);
elArrowsBtn.addEventListener("click", () => {
  breakArrows = !breakArrows;
  lsSet("golf.breakArrows", breakArrows);
  elArrowsBtn.classList.toggle("active", breakArrows);
});
// Cinematic landings: per-device cosmetic (like break arrows), not a tournament setting.
const elCineBtn = document.getElementById("hm-cine");
elCineBtn.classList.toggle("active", cineEnabled);
elCineBtn.addEventListener("click", () => {
  cineEnabled = !cineEnabled;
  lsSet("golf.cineLanding", cineEnabled);
  elCineBtn.classList.toggle("active", cineEnabled);
});
const elGreenViewBtn = document.getElementById("green-view-btn");
elGreenViewBtn.addEventListener("click", (e) => { e.stopPropagation(); openGreenView(); });
// Slightly-3D tilted view: per-device camera preference (like break arrows).
const elTiltBtn = document.getElementById("tilt-view-btn");
elTiltBtn.classList.toggle("active", tiltView);
elTiltBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  tiltView = !tiltView;
  lsSet("golf.tiltView", tiltView);
  elTiltBtn.classList.toggle("active", tiltView);
  // Apple-ground courses: the toggle pitches the REAL map camera instead
  // (applePitchT in updateCamera); the canvas squash must stay off there.
  camera.tTilt = (tiltView && !appleGroundActive()) ? TUNE.tiltCos : 1;
  if (mode === "course" || mode === "range") frameTarget(); // refit zoom for the new lean
});
// Camera toggle, so no ball-state gating — just not under the 3D overlays.
let _tiltBtnShown = false;
function updateTiltBtn() {
  const show = (mode === "course" || mode === "range") && !greenView && !cine;
  if (show !== _tiltBtnShown) { _tiltBtnShown = show; elTiltBtn.classList.toggle("hidden", !show); }
}
// Show the read-green button exactly when green reading matters: in course
// play, ball at rest, and a green in play (ball on one or pin's green).
let _gvBtnShown = false;
function updateGreenViewBtn() {
  const show = mode === "course" && HOLE && !HOLE.isRange && !greenView && !cine
             && canSwing() && greensInPlay().length > 0;
  if (show !== _gvBtnShown) { _gvBtnShown = show; elGreenViewBtn.classList.toggle("hidden", !show); }
}

function openHud() {
  elHudMenu.classList.remove("hidden"); elHudBtn.classList.add("open");
  const hmForfeit = document.getElementById("hm-forfeit");
  if (hmForfeit) hmForfeit.classList.toggle("hidden", !canForfeitHole());
}
function closeHud() {
  elHudMenu.classList.add("hidden");
  elHudBtn.classList.remove("open");
}
elHudBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  elHudMenu.classList.contains("hidden") ? openHud() : closeHud();
});
// Toggles/sliders inside the menu keep it open; the action items call closeHud() themselves.
elHudMenu.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", closeHud);

function buildHoleGrid() {
  if (!course) return;
  elHoleGrid.innerHTML = "";
  // In a match (online or CPU), holes you've already finished are locked — no
  // going back to re-play a completed hole. The current hole stays selectable.
  const finished = inMatch() ? new Set(round.holeStats.map((h) => h.hole)) : null;
  course.holes.forEach((h, i) => {
    const num = h.num || i + 1;
    const locked = finished && finished.has(num) && i !== holeIndex;
    const cell = document.createElement("button");
    cell.className = "hole-cell" + (i === holeIndex ? " current" : "") + (locked ? " done" : "");
    cell.innerHTML = `<span class="hn">${num}</span><span class="hp">${locked ? "Done" : "Par " + h.par}</span>`;
    if (locked) {
      cell.disabled = true;
    } else {
      cell.addEventListener("click", () => {
        closeCourseMenu();
        advanceHole(() => { holeIndex = i; setHole(course.holes[i]); });
      });
    }
    elHoleGrid.appendChild(cell);
  });
}
function openCourseMenu() { if (mode !== "course") return; buildHoleGrid(); elCourseMenu.classList.remove("hidden"); }
function closeCourseMenu() { elCourseMenu.classList.add("hidden"); }
document.getElementById("cm-resume").addEventListener("click", closeCourseMenu);
document.getElementById("cm-home").addEventListener("click", () => { closeCourseMenu(); showMenu(); });

function setSlopeMode(on) {
  showSlope = on;
  elSlopeBtn.classList.toggle("active", on);
}
const elOOBBtn = document.getElementById("hm-oob");
function setOOBMode(on) {
  showOOB = on;
  elOOBBtn.classList.toggle("active", on);
}
function aimAtHole() {
  const a = Math.atan2(HOLE.holePos.y - state.ball.y, HOLE.holePos.x - state.ball.x);
  camera.tAngle = -Math.PI / 2 - a;
  frameTarget();
  cameraAiming = true;
}
function setMeasureMode(on) {
  measureMode = on;
  if (!on) { measurePoint = null; measureDragging = false; }
  elMeasureBtn.classList.toggle("active", on);
}
document.getElementById("hm-aim").addEventListener("click", () => { aimAtHole(); closeHud(); });
elMeasureBtn.addEventListener("click", () => setMeasureMode(!measureMode));
elSlopeBtn.addEventListener("click", () => setSlopeMode(!showSlope));
elOOBBtn.addEventListener("click", () => setOOBMode(!showOOB));
document.getElementById("hm-card").addEventListener("click", () => {
  showRoundSummary(true);   // works from hole 1 too — shows an empty card
  closeHud();
});
document.getElementById("hm-holes").addEventListener("click", () => { closeHud(); openCourseMenu(); });
document.getElementById("hm-home").addEventListener("click", () => { closeHud(); showMenu(); });
const elSoundBtn = document.getElementById("hm-sound");
if (elSoundBtn) {
  elSoundBtn.classList.toggle("active", !muted);
  elSoundBtn.addEventListener("click", () => {
    setMuted(!muted);
    elSoundBtn.classList.toggle("active", !muted);
    if (!muted) playPutt();   // little confirmation blip when re-enabling
  });
}
function setWind(on) {
  windEnabled = on;
  document.getElementById("hm-wind").classList.toggle("active", on);
  if (!on) wind.speed = 0; // kill current wind immediately when toggled off
}
function setSlotted(on) {
  slottedMode = on;
  const btn = document.getElementById("hm-slotted"); // admin-only; not in the player menu
  if (btn) btn.classList.toggle("active", on);
}
function setAutoAim(on) {
  autoAimEnabled = on;
  const btn = document.getElementById("hm-autoaim");
  if (btn) btn.classList.toggle("active", on);
}
function setChip(on) {
  chipEnabled = on;
  const btn = document.getElementById("hm-chip");
  if (btn) btn.classList.toggle("active", on);
}
function setLieEffect(on) {
  lieEffectEnabled = on;
  const btn = document.getElementById("hm-lieeffect");
  if (btn) btn.classList.toggle("active", on);
  updateStats(); // refresh the lie-effect HUD row immediately
}
function setShotPreview(on) {
  shotPreviewEnabled = on;
  if (!on) shotPreview = null; // drop any live marker the instant it's turned off
  const btn = document.getElementById("hm-preview");
  if (btn) btn.classList.toggle("active", on);
}
document.getElementById("hm-autoclb").addEventListener("click", () => setAutoClub(!autoClubEnabled));
document.getElementById("hm-wind").addEventListener("click", () => setWind(!windEnabled));
const elSlottedBtn = document.getElementById("hm-slotted");
if (elSlottedBtn) elSlottedBtn.addEventListener("click", () => setSlotted(!slottedMode));
const elAutoAimBtn = document.getElementById("hm-autoaim");
if (elAutoAimBtn) elAutoAimBtn.addEventListener("click", () => setAutoAim(!autoAimEnabled));
const elChipBtn = document.getElementById("hm-chip");
if (elChipBtn) elChipBtn.addEventListener("click", () => setChip(!chipEnabled));
const elShotPreviewBtn = document.getElementById("hm-preview");
if (elShotPreviewBtn) elShotPreviewBtn.addEventListener("click", () => setShotPreview(!shotPreviewEnabled));

// =====================================================================
//  Movable HUD (mobile) — let players drag corner panels out of the way.
//  An edit mode (body.hud-edit, toggled from the HUD menu) makes the
//  normally pass-through panels grabbable; positions persist per-id in
//  localStorage as inline left/top px and are re-clamped on resize.
// =====================================================================
const HUD_MOVABLE_IDS = ["scorecard", "hint", "hm-club-row", "hud-btn"];
const HUD_POS_KEY = "golf.hudPos";
const HUD_SCALE_MIN = 0.6, HUD_SCALE_MAX = 2.2, HUD_SCALE_STEP = 0.1;
let hudEditOn = false;

function loadHudPos() {
  try { return JSON.parse(localStorage.getItem(HUD_POS_KEY)) || {}; }
  catch (_) { return {}; }
}
function saveHudPos(pos) {
  try { localStorage.setItem(HUD_POS_KEY, JSON.stringify(pos)); } catch (_) {}
}
function clampHudScale(s) { return Math.min(HUD_SCALE_MAX, Math.max(HUD_SCALE_MIN, s)); }
function curHudScale(el) { return parseFloat(el.dataset.hudScale) || 1; }
// Scale a panel about its top-left (so its left/top anchor stays put). Stashes
// the factor on the element so drag/clamp/save can read it back.
function applyHudScale(el, s) {
  s = clampHudScale(s || 1);
  el.dataset.hudScale = s;
  el.style.transformOrigin = "top left";
  el.style.transform = s !== 1 ? "scale(" + s + ")" : "";
  return s;
}
// Pin an element to absolute left/top px (clearing its right/bottom anchor),
// clamped so it stays on-screen (rect already reflects any scale).
function placeHudEl(el, x, y) {
  const r = el.getBoundingClientRect();
  const maxX = Math.max(0, window.innerWidth - r.width);
  const maxY = Math.max(0, window.innerHeight - r.height);
  x = Math.min(Math.max(0, x), maxX);
  y = Math.min(Math.max(0, y), maxY);
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.right = "auto";
  el.style.bottom = "auto";
  return { x, y };
}
// Apply a saved {x,y,s} record to one panel (scale first, then place/clamp).
function applyHudRec(el, rec) {
  applyHudScale(el, rec.s || 1);
  return placeHudEl(el, rec.x, rec.y);
}
// Apply saved positions+scales (mobile only — desktop keeps the CSS layout).
function applyHudPositions() {
  if (!IS_DESKTOP) {
    const pos = loadHudPos();
    HUD_MOVABLE_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el && pos[id]) applyHudRec(el, pos[id]);
    });
  }
}
// Keep moved panels on-screen after a resize/rotation.
function clampHudPositions() {
  if (IS_DESKTOP) return;
  const pos = loadHudPos();
  let changed = false;
  HUD_MOVABLE_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el || !pos[id]) return;
    const p = applyHudRec(el, pos[id]);
    if (p.x !== pos[id].x || p.y !== pos[id].y) { pos[id] = { x: p.x, y: p.y, s: pos[id].s }; changed = true; }
  });
  if (changed) saveHudPos(pos);
}
function resetHudPositions() {
  saveHudPos({});
  HUD_MOVABLE_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.left = el.style.top = el.style.right = el.style.bottom = "";
      el.style.transform = el.style.transformOrigin = "";
      delete el.dataset.hudScale;
    }
  });
}

// One gesture at a time on whichever movable panel is grabbed: 1 finger drags,
// 2 fingers pinch-zoom (and pan by the midpoint). lastHudEl powers the +/-
// zoom buttons so phones can resize without a pinch.
let hudGesture = null;
let lastHudEl = null;
function gMid(pts) {
  let x = 0, y = 0;
  pts.forEach((p) => { x += p.x; y += p.y; });
  return { x: x / pts.length, y: y / pts.length };
}
function gDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
// Re-baseline the gesture against the panel's current rect/scale (on a pointer
// going down or up, so adding/removing a finger doesn't jump).
function rebaseGesture() {
  const g = hudGesture, pts = [...g.pointers.values()];
  const r = g.el.getBoundingClientRect();
  g.startLeft = r.left; g.startTop = r.top;
  g.startScale = curHudScale(g.el);
  g.startMid = gMid(pts);
  g.startDist = pts.length >= 2 ? gDist(pts[0], pts[1]) : 0;
}
function hudPointerDown(e) {
  if (!hudEditOn) return;
  const el = e.currentTarget;
  if (hudGesture && hudGesture.el !== el) return; // one panel at a time
  lastHudEl = el;
  if (!hudGesture) hudGesture = { el, pointers: new Map(), pos: loadHudPos() };
  hudGesture.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  el.classList.add("hud-dragging");
  try { el.setPointerCapture && el.setPointerCapture(e.pointerId); } catch (_) {}
  rebaseGesture();
  e.preventDefault();
  e.stopPropagation();
}
function hudPointerMove(e) {
  const g = hudGesture;
  if (!g || !g.pointers.has(e.pointerId)) return;
  g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const pts = [...g.pointers.values()];
  if (pts.length >= 2 && g.startDist > 0) {
    applyHudScale(g.el, g.startScale * gDist(pts[0], pts[1]) / g.startDist);
  }
  const mid = gMid(pts);
  placeHudEl(g.el, g.startLeft + (mid.x - g.startMid.x), g.startTop + (mid.y - g.startMid.y));
  e.preventDefault();
}
function hudPointerUp(e) {
  const g = hudGesture;
  if (!g) return;
  g.pointers.delete(e.pointerId);
  if (g.pointers.size > 0) { rebaseGesture(); return; } // lifted one of two -> keep going
  saveHudEl(g.el, g.pos);
  g.el.classList.remove("hud-dragging");
  hudGesture = null;
}
// Persist a panel's current left/top/scale into the pos map and store it.
function saveHudEl(el, pos) {
  pos = pos || loadHudPos();
  const r = el.getBoundingClientRect();
  pos[el.id] = { x: r.left, y: r.top, s: curHudScale(el) };
  saveHudPos(pos);
}
// +/- zoom buttons: step the scale of the last-touched panel about its top-left.
function zoomHud(dir) {
  const el = lastHudEl || document.getElementById(HUD_MOVABLE_IDS[0]);
  if (!el) return;
  applyHudScale(el, curHudScale(el) + dir * HUD_SCALE_STEP);
  placeHudEl(el, parseFloat(el.style.left) || el.getBoundingClientRect().left,
                 parseFloat(el.style.top) || el.getBoundingClientRect().top); // re-clamp
  saveHudEl(el);
}
function wireHudDrag() {
  HUD_MOVABLE_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("pointerdown", hudPointerDown);
    el.addEventListener("pointermove", hudPointerMove);
    el.addEventListener("pointerup", hudPointerUp);
    el.addEventListener("pointercancel", hudPointerUp);
    // While editing, swallow clicks so a tap repositions instead of firing
    // the panel's own action (open menu / change club).
    el.addEventListener("click", (e) => {
      if (hudEditOn) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  });
}
function setHudEdit(on) {
  hudEditOn = on;
  document.body.classList.toggle("hud-edit", on);
  const bar = document.getElementById("hud-edit-bar");
  if (bar) bar.classList.toggle("hidden", !on);
  const btn = document.getElementById("hm-movehud");
  if (btn) btn.classList.toggle("active", on);
}
wireHudDrag();
document.getElementById("hm-movehud").addEventListener("click", () => {
  setHudEdit(!hudEditOn);
  closeHud(); // get the dropdown out of the way so panels are draggable
});
document.getElementById("hm-resethud").addEventListener("click", () => {
  resetHudPositions();
  closeHud();
});
const elHudEditDone = document.getElementById("hud-edit-done");
if (elHudEditDone) elHudEditDone.addEventListener("click", () => setHudEdit(false));
const elHudZoomIn = document.getElementById("hud-zoom-in");
const elHudZoomOut = document.getElementById("hud-zoom-out");
if (elHudZoomIn) elHudZoomIn.addEventListener("click", () => zoomHud(1));
if (elHudZoomOut) elHudZoomOut.addEventListener("click", () => zoomHud(-1));

// =====================================================================
//  Game settings — toggleable aids. Defaults are GLOBAL (admin-set via
//  Supabase, read by everyone) and snapshotted per tournament so every
//  player faces the same conditions. Each def maps a key <-> live state.
// =====================================================================
const SETTING_DEFS = [
  { key: "autoClub",    label: "Auto club",      icon: "ic-flag",   get: () => autoClubEnabled, set: (v) => setAutoClub(v) },
  { key: "autoAim",     label: "Auto-aim at pin", icon: "ic-target", get: () => autoAimEnabled,  set: (v) => setAutoAim(v) },
  { key: "wind",        label: "Wind",            icon: "ic-wind",   get: () => windEnabled,     set: (v) => setWind(v) },
  { key: "slope",       label: "Slope lines",     icon: "ic-slope",  get: () => showSlope,       set: (v) => setSlopeMode(v) },
  { key: "oob",         label: "OB areas",        icon: "ic-ob",     get: () => showOOB,         set: (v) => setOOBMode(v) },
  { key: "rangefinder", label: "Range finder",    icon: "ic-ruler",  get: () => measureMode,     set: (v) => setMeasureMode(v) },
  { key: "slotted",     label: "Slotted mode",    icon: "ic-target", get: () => slottedMode,     set: (v) => setSlotted(v) },
  { key: "chip",        label: "Chip mode",       icon: "ic-chip",   get: () => chipEnabled,     set: (v) => setChip(v) },
  { key: "lieEffect",   label: "Lie effect",      icon: "ic-slope",  get: () => lieEffectEnabled, set: (v) => setLieEffect(v) },
  { key: "shotPreview", label: "Shot preview",    icon: "ic-target", get: () => shotPreviewEnabled, set: (v) => setShotPreview(v) },
];
// Effective defaults: hardcoded fallback until the global row loads.
// Immutable fallback for each setting — used when a saved/loaded settings row
// predates a key (e.g. a global Supabase row baked before "chip" existed). A
// MISSING key falls back to this default, NOT to false.
const SETTING_DEFAULTS = { autoClub: true, autoAim: true, wind: false, slope: true, oob: true, rangefinder: false, slotted: false, chip: true, lieEffect: true, shotPreview: false };
let gameDefaults = Object.assign({}, SETTING_DEFAULTS);
let activeSettings = Object.assign({}, gameDefaults); // settings in force for the current round

function applySettings(s) {
  if (!s) return;
  for (const d of SETTING_DEFS) if (typeof s[d.key] === "boolean") d.set(s[d.key]);
}
function normalizeSettings(s) {
  const out = {};
  // present boolean wins; otherwise fall back to the key's default (not false)
  for (const d of SETTING_DEFS)
    out[d.key] = (s && typeof s[d.key] === "boolean") ? s[d.key] : !!SETTING_DEFAULTS[d.key];
  return out;
}

// --- Admin panel: edit GLOBAL defaults (admin only); tournaments snapshot these ---
let _adminDraft = null;
function renderAdminToggles() {
  const host = document.getElementById("admin-toggles");
  if (!host) return;
  host.innerHTML = "";
  for (const d of SETTING_DEFS) {
    const row = document.createElement("button");
    row.className = "admin-toggle" + (_adminDraft[d.key] ? " active" : "");
    row.innerHTML = '<span class="ic ' + d.icon + '"></span>' + d.label;
    row.onclick = () => { _adminDraft[d.key] = !_adminDraft[d.key]; renderAdminToggles(); };
    host.appendChild(row);
  }
}
function openAdminPanel() {
  if (!isTournamentAdmin()) return;
  _adminDraft = normalizeSettings(gameDefaults);
  renderAdminToggles();
  const s = document.getElementById("admin-status"); if (s) s.textContent = "";
  document.getElementById("admin-settings").classList.remove("hidden");
}
function closeAdminPanel() {
  const m = document.getElementById("admin-settings"); if (m) m.classList.add("hidden");
}
(function wireAdmin() {
  const open = document.getElementById("menu-admin");
  if (open) open.addEventListener("click", openAdminPanel);
  const close = document.getElementById("admin-close");
  if (close) close.addEventListener("click", closeAdminPanel);
  const save = document.getElementById("admin-save");
  if (save) save.addEventListener("click", async () => {
    const status = document.getElementById("admin-status");
    save.disabled = true; save.textContent = "Saving…";
    const ok = await saveGameSettings(_adminDraft);
    save.disabled = false; save.textContent = "Save global defaults";
    if (ok) {
      gameDefaults = normalizeSettings(_adminDraft);
      activeSettings = Object.assign({}, gameDefaults);
      if (status) status.textContent = "Saved ✓ — applies to all players.";
    } else if (status) {
      status.textContent = "Save failed (admin only).";
    }
  });
})();

// =====================================================================
//  HUD display preferences — which panels are shown. Per-device
//  (localStorage), NOT part of SETTING_DEFS: purely cosmetic, never
//  snapshotted into tournaments/matches. #hud-btn is deliberately
//  excluded so the player can never lock themselves out of Settings.
// =====================================================================
const HUD_VIS_KEY = "golf.hudVis";
const HUD_VIS_DEFS = [
  { key: "scorecard", id: "scorecard",   label: "Scorecard bar", icon: "ic-clipboard" },
  { key: "stats",     id: "stats",       label: "Shot info",     icon: "ic-ruler" },
  { key: "club",      id: "hm-club-row", label: "Club selector", icon: "ic-flag" },
  { key: "hint",      id: "hint",        label: "Swing hint",    icon: "ic-target" },
];
let hudVis = (() => {
  const saved = lsGet(HUD_VIS_KEY, {});
  const out = {};
  for (const d of HUD_VIS_DEFS) out[d.key] = typeof saved[d.key] === "boolean" ? saved[d.key] : true;
  return out;
})();
function applyHudVis() {
  for (const d of HUD_VIS_DEFS) {
    if (!d.id) continue; // wind: guarded in drawWindIndicator()
    const el = document.getElementById(d.id);
    if (el) el.classList.toggle("hud-off", !hudVis[d.key]);
  }
}
function setHudVis(key, on) {
  hudVis[key] = !!on;
  lsSet(HUD_VIS_KEY, hudVis);
  applyHudVis();
  renderHudVisToggles();
}
function renderHudVisToggles() {
  const host = document.getElementById("hs-display");
  if (!host) return;
  host.innerHTML = "";
  for (const d of HUD_VIS_DEFS) {
    const b = document.createElement("button");
    b.className = "hm-item" + (hudVis[d.key] ? " active" : "");
    b.innerHTML = '<span class="ic ' + d.icon + '"></span>' + d.label;
    b.onclick = () => setHudVis(d.key, !hudVis[d.key]);
    host.appendChild(b);
  }
}
applyHudVis();
renderHudVisToggles();

// Swing sensitivity — per-device (localStorage), like HUD display prefs.
// Multiplies swipe speed before the power mapping, so higher = softer flick
// reaches full power. Applied in swingEnd() (touch/mouse) and launch() (wheel).
const SENS_KEY = "golf.swingSensitivity";
let swingSens = Math.min(3, Math.max(0.5, +lsGet(SENS_KEY, 3) || 3));
(() => {
  const slider = document.getElementById("sens-slider");
  const val = document.getElementById("sens-val");
  if (!slider) return;
  slider.value = Math.round(swingSens * 100);
  val.textContent = slider.value;
  slider.addEventListener("input", () => {
    val.textContent = slider.value;
    swingSens = parseInt(slider.value, 10) / 100;
    lsSet(SENS_KEY, swingSens);
  });
})();

// Right-gutter shot slider — ONE widget, two meanings by context (syncSpinSlider):
//   chip range  -> SPIN  (bite +1 .. run −1), drives chipSpinBias. Resets each hole.
//   full shot   -> FLIGHT (std 0 .. high +1), drives flightBias — the flighted high
//                  spinner (see TUNE.flightHi*). One-shot: consumed & reset on launch.
// Neither is persisted, so a big setting never silently carries over.
const elChipSpin = document.getElementById("chip-spin");
const elChipSpinSlider = document.getElementById("chip-spin-slider");
const elChipSpinVal = document.getElementById("chip-spin-val");
const elCsTop = document.getElementById("cs-top");
const elCsBot = document.getElementById("cs-bot");
const elCsName = document.getElementById("cs-name");
let spinSliderMode = null;  // "chip" | "flight" — what the gutter slider currently drives
function chipSpinLabel(pct) { return pct > 0 ? "+" + pct : "" + pct; }
function resetChipSpin() {
  chipSpinBias = 0;
  flightBias = 0;
  spinSliderMode = null;  // force a relabel + revalue on the next sync
}
function resetFlightBias() {
  flightBias = 0;
  spinSliderMode = null;
}
// Show/relabel/revalue the gutter slider for the current context. Called from
// updateStats() so it tracks ball position, rest state and chip range.
function syncSpinSlider() {
  if (!elChipSpin || !elChipSpinSlider) return;
  const show = mode === "course" && !state.moving && !state.inHole &&
               surfaceAt(state.ball.x, state.ball.y) !== "green" &&
               selectedClub !== "putter";
  elChipSpin.classList.toggle("hidden", !show);
  if (!show) return;
  const m = chipActiveNow() ? "chip" : "flight";
  if (m === spinSliderMode) return;
  spinSliderMode = m;
  if (m === "chip") {
    elChipSpinSlider.min = -100;
    if (elCsTop) elCsTop.textContent = "bite";
    if (elCsBot) elCsBot.textContent = "run";
    if (elCsName) elCsName.textContent = "SPIN";
    elChipSpinSlider.value = Math.round(chipSpinBias * 100);
    if (elChipSpinVal) elChipSpinVal.textContent = chipSpinLabel(Math.round(chipSpinBias * 100));
  } else {
    elChipSpinSlider.min = 0;
    if (elCsTop) elCsTop.textContent = "high";
    if (elCsBot) elCsBot.textContent = "std";
    if (elCsName) elCsName.textContent = "FLIGHT";
    elChipSpinSlider.value = Math.round(flightBias * 100);
    if (elChipSpinVal) elChipSpinVal.textContent = "" + Math.round(flightBias * 100);
  }
}
if (elChipSpinSlider) {
  elChipSpinSlider.addEventListener("input", () => {
    const pct = parseInt(elChipSpinSlider.value, 10);
    if (spinSliderMode === "flight") {
      flightBias = pct / 100;
      if (elChipSpinVal) elChipSpinVal.textContent = "" + pct;
    } else {
      chipSpinBias = pct / 100;
      if (elChipSpinVal) elChipSpinVal.textContent = chipSpinLabel(pct);
    }
    updateStats();  // refresh the carry readout live as the slider moves
  });
}

// Club selector: +/- steps through the bag (putter is automatic on the green).
function updateClubUI() {
  const onGreen = HOLE && !HOLE.isRange && surfaceAt(state.ball.x, state.ball.y) === "green";
  elHmClubRow.classList.toggle("putting", !!onGreen);
  if (onGreen) {
    elClubName.textContent = "Putter"; elClubYds.textContent = "";
  } else if (selectedClub === "putter") {
    elClubName.textContent = "Putter"; elClubYds.textContent = "~30y";
  } else {
    const c = TUNE.clubs[selectedClub];
    elClubName.textContent = c.name;
    if (chipActiveNow()) {
      // Chip: show where the ball LANDS (carry), which moves with the spin slider —
      // more spin lands it deeper, less spin lands it short (rolls the rest to the pin).
      const b = state.ball;
      const land = playsLikeYards(b.x, b.y).plays * chipSpinParams().landFrac;
      elClubYds.textContent = Math.round(land) + "y";
    } else {
      // Full shot: fold the FLIGHT slider's carry cost into the readout live.
      elClubYds.textContent = Math.round(c.carry * (1 - (1 - TUNE.flightHiCarry) * flightBias)) + "y";
    }
  }
}
function setAutoClub(on) {
  autoClubEnabled = on;
  const btn = document.getElementById("hm-autoclb");
  if (btn) btn.classList.toggle("active", on);
  if (on) autoClub(); // immediately pick the right club when re-enabling
}
function stepClub(delta) { // +1 = longer club, -1 = shorter
  manualClubThisShot = true; // override only this shot; auto resumes after it
  const i = CLUB_ORDER.indexOf(selectedClub);
  selectedClub = CLUB_ORDER[Math.max(0, Math.min(CLUB_ORDER.length - 1, i - delta))];
  updateClubUI();
}
// tap club display to cycle forward; arrow keys still work for full step control
document.getElementById("hm-club-cur").addEventListener("click", () => stepClub(1));
// up/down arrow buttons: up = longer club, down = shorter (matches ↑/↓ keys)
document.getElementById("hm-club-up").addEventListener("click", () => stepClub(1));
document.getElementById("hm-club-down").addEventListener("click", () => stepClub(-1));

// ← / → aim: a single tap is one small eased nudge; holding (OS auto-repeat)
// switches to a smooth continuous turn (updateCamera). Swipe up fires along it.
function aimNudge(dir) {
  if ((mode !== "course" && mode !== "range") || !canSwing()) return;
  camera.tAngle += dir * AIM_NUDGE;
  frameTarget();
  cameraAiming = true; // eased to the new target by updateCamera
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && greenView) { closeGreenView(); return; }
  if (e.key === "Escape" && cine) { closeCine(); return; }
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    if (e.repeat) return;              // one club step per tap
    stepClub(e.key === "ArrowUp" ? 1 : -1); // up = longer club, down = shorter
    return;
  }
  const dir = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  if (e.repeat) aimKey = dir;   // held -> continuous
  else aimNudge(dir);           // single tap -> one fixed nudge
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft" && aimKey === 1) aimKey = 0;
  else if (e.key === "ArrowRight" && aimKey === -1) aimKey = 0;
});

function showMenu() {
  mode = "menu";
  if (greenView) closeGreenView();
  if (cine || cinePending) closeCine();
  // Home abandons a local bot/CPU match — there is no resume path, and leaving
  // it live bleeds match HUD (turn banner, "Match:" score) into the next solo
  // round. Online matches are left untouched here (their lifecycle is remote).
  if (cpuMatch && activeMatch) leaveMatch();
  elMenu.classList.remove("hidden");
  elCourseSelect.classList.add("hidden");
  elPreview.classList.add("hidden");
  elRangeUI.classList.add("hidden");
  elStats.classList.add("hidden");
  elHudBtn.classList.add("hidden");
  elHmClubRow.classList.add("hidden");
  closeHud();
  setMeasureMode(false);
  setSlopeMode(true);   // slope relief on by default
  closeCourseMenu();
  renderMenuChips();
  // Leaving to the menu ends any in-progress Tour Event round + hides the scorebug.
  tourPlayMode = false;
  stopTourPoll();
  updateTourBug();
}

// Home-menu chips: daily streak + today's featured (free) course.
function renderMenuChips() {
  const wrap = document.getElementById("menu-chips");
  if (!wrap) return;
  const stEl = document.getElementById("menu-streak");
  const ftEl = document.getElementById("menu-featured");
  const st = getDaily();
  let any = false;
  if (stEl) {
    const show = (st.streak || 0) > 0;
    stEl.classList.toggle("hidden", !show);
    if (show) {
      stEl.textContent = "Daily streak: " + st.streak +
        (st.lastDate !== todayStr() ? " · play today to keep it" : "");
      any = true;
    }
  }
  if (ftEl) {
    const fid = dailyFeaturedCourseId();
    const c = fid && COURSES.find((x) => x.id === fid);
    ftEl.classList.toggle("hidden", !c);
    if (c) { ftEl.textContent = "Free today: " + c.name; any = true; }
  }
  wrap.classList.toggle("hidden", !any);
}

// Switch the world scale (yards/unit) and refresh derived power if it changed.
function setYardsPerUnit(ypu) {
  if (ypu && YARDS_PER_UNIT !== ypu) { YARDS_PER_UNIT = ypu; recalcPower(); }
}

function startCourse() {
  // Locked-course backstop: every picker path funnels here. Live-match guests
  // play the host's course and tournament rounds are admin-chosen — exempt.
  if (!matchLive() && activeTournamentRound === null && !courseUnlocked(selectedCourseId)) {
    showToast("Locked — " + unlockReq(selectedCourseId).label, 2400);
    showCourseSelect();
    return;
  }
  // Match host is mid-setup: the course pick funnels here → divert to the
  // configured match instead of starting a solo round.
  if (matchSetupMode) { startConfiguredMatch(); return; }
  // Picking a course for a bot match: remember it and return to the roster.
  if (botCoursePickMode) {
    botCoursePickMode = false;
    botCourseId = selectedCourseId;
    hideCourseSelect();
    elPreview.classList.add("hidden");
    openBotSelect();
    return;
  }
  mode = "course";
  dailyMode = false;
  track("round_start", { mode: matchLive() ? "match" : "solo", course: selectedCourseId });
  // Match rounds use the match's frozen conditions; tournament rounds use the
  // tournament's; otherwise the global defaults. Apply before setHole so
  // wind/auto-club pick them up.
  activeSettings = matchLive()
    ? normalizeSettings(activeMatch.settings)
    : (activeTournamentRound !== null && activeTournament && activeTournament.settings)
      ? normalizeSettings(activeTournament.settings)
      : normalizeSettings(gameDefaults);
  applySettings(activeSettings);
  elMenu.classList.add("hidden");
  elCourseSelect.classList.add("hidden");
  elPreview.classList.add("hidden");
  elRangeUI.classList.add("hidden");
  document.getElementById("round-end").classList.add("hidden");
  elScorecard.style.display = "";
  elHudBtn.classList.remove("hidden");
  elHmClubRow.classList.remove("hidden");
  elHmCourseItems.classList.remove("hidden");
  // Match standings toggle lives in the HUD menu; only relevant in a match.
  const hmMatch = document.getElementById("hm-match");
  if (hmMatch) hmMatch.classList.toggle("hidden", !matchLive());
  selectedClub = "driver";
  shot.carry = shot.total = null; shot.mph = 0;
  round.score = 0; round.holesPlayed = 0; round.holeStats = []; round._submitted = false;
  round._retried = new Set();   // hole indexes already replayed via a rewarded ad (once each)
  // Match + tournament pins are frozen per game so every entrant gets the same
  // pins; casual rounds get fresh pins each time.
  round.pinSeed = matchLive()
    ? strSeed("m:" + activeMatch.id)
    : (activeTournamentRound !== null && activeTournament)
      ? strSeed((activeTournament.id || "t") + ":" + activeTournamentRound)
      : (Math.random() * 0xffffffff) | 0;
  if (course && course.id === selectedCourseId) {
    setYardsPerUnit(course.yardsPerUnit);   // already loaded: restore scale (range may have changed it)
    holeIndex = 0;
    setHole(course.holes[0]);
  } else {
    // load (or switch to) the chosen course; loadCourse sets the first hole
    loadCourse(selectedCourseId).catch((e) => { console.warn(e); if (!course) setHole(FALLBACK_HOLE); });
  }
}

// =====================================================================
//  Daily Challenge — one date-seeded hole, same for everyone, streak + share.
//  Deterministic from the date string, so no server is needed to agree on
//  today's course/hole. Reuses loadCourse/setHole and the Supabase board.
// =====================================================================
let dailyMode = false;
let dailyInfo = null; // { date, courseId, holeNum }

// Deterministic PRNG (mulberry32) + FNV-1a string hash for the seed.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function todayStr() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function dailyCourseFor(dateStr) {
  // Unconditional exclusion (not the viewer's-own-admin-status visibleCourses()
  // filter) — the daily pick is the same course for every player that day, so
  // it can't depend on who's asking.
  const pool = (COURSES.length ? COURSES : FALLBACK_COURSES).filter((c) => !HIDDEN_COURSE_IDS.has(c.id));
  const rnd = mulberry32(strSeed(dateStr));
  return pool[Math.floor(rnd() * pool.length)];
}

// Daily featured course: one normally-locked course is free for everyone
// today. Pool = all non-free courses (not "currently locked") so the pick is
// identical for every player and never shifts as an individual unlocks things.
function dailyFeaturedCourseId() {
  const pool = COURSES.filter((c) => unlockReq(c.id).type !== "free").map((c) => c.id);
  if (!pool.length) return null;
  return pool[Math.floor(mulberry32(strSeed("feat:" + todayStr()))() * pool.length)];
}
function isDailyFeatured(id) { return id === dailyFeaturedCourseId(); }

async function startDaily() {
  const dateStr = todayStr();
  const c = dailyCourseFor(dateStr);
  mode = "course"; dailyMode = true; activeTournamentRound = null;
  track("round_start", { mode: "daily", course: c });
  activeSettings = normalizeSettings(gameDefaults);
  applySettings(activeSettings);
  elMenu.classList.add("hidden");
  elCourseSelect.classList.add("hidden");
  elPreview.classList.add("hidden");
  elRangeUI.classList.add("hidden");
  document.getElementById("round-end").classList.add("hidden");
  elScorecard.style.display = "";
  elHudBtn.classList.remove("hidden");
  elHmClubRow.classList.remove("hidden");
  elHmCourseItems.classList.remove("hidden");
  selectedClub = "driver";
  shot.carry = shot.total = null; shot.mph = 0;
  round.score = 0; round.holesPlayed = 0; round.holeStats = []; round._submitted = false;
  round._retried = new Set();   // hole indexes already replayed via a rewarded ad (once each)
  round.pinSeed = strSeed(dateStr);  // date-seeded pins: same for everyone today
  try {
    if (!course || course.id !== c.id) await loadCourse(c.id);
    setYardsPerUnit(course.yardsPerUnit);
    const idx = Math.floor(mulberry32(strSeed(dateStr + ":hole"))() * course.holes.length);
    holeIndex = idx;
    dailyInfo = { date: dateStr, courseId: c.id, holeNum: course.holes[idx].num || idx + 1 };
    setHole(course.holes[idx]);
    showToast(`Daily: ${c.name}, hole ${dailyInfo.holeNum}`, 2400);
  } catch (e) {
    console.warn("daily load failed", e);
    dailyInfo = { date: dateStr, courseId: c.id, holeNum: 1 };
    setHole(FALLBACK_HOLE);
  }
}

function getDaily() { return lsGet("golf.daily", { lastDate: null, streak: 0 }); }
// Called once on completing today's daily: update streak (with a 1-day grace),
// celebrate, and copy a shareable result.
function finishDaily(totStrk) {
  const dateStr = (dailyInfo && dailyInfo.date) || todayStr();
  const st = getDaily();
  if (st.lastDate !== dateStr) {
    const day = 864e5, p = (n) => String(n).padStart(2, "0");
    const fmt = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
    const yest = fmt(Date.now() - day), dbefore = fmt(Date.now() - 2 * day);
    if (st.lastDate === yest || st.lastDate === dbefore) st.streak = (st.streak || 0) + 1; // consecutive (+1 grace day)
    else st.streak = 1;                                                                    // streak broke
    st.lastDate = dateStr; st.lastScore = totStrk; st.lastToPar = round.score;
    lsSet("golf.daily", st);
  }
  track("daily_played", { streak: st.streak, strokes: totStrk, to_par: round.score });
  spawnBurst(HOLE.holePos.x, HOLE.holePos.y, "confetti");
  const sub = document.getElementById("re-subtitle");
  sub.textContent += ` · Streak ${st.streak}`;
  const text = `Golf Daily ${dateStr} · ${totStrk} strokes (${formatToPar(round.score)}) · ⛳️🔥${st.streak}`;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(text).then(() => showToast("Daily result copied", 2000)).catch(() => {});
  } catch (e) {}
}

let rangeRec = null; // baked real driving range (Pinehurst practice range)
async function startRange() {
  mode = "range";
  dailyMode = false;
  elMenu.classList.add("hidden");
  elScorecard.style.display = "none";
  elRangeUI.classList.remove("hidden");
  elHudBtn.classList.remove("hidden");
  elHmClubRow.classList.remove("hidden");
  elHmCourseItems.classList.add("hidden");   // no course tools in range mode
  setMeasureMode(false);
  setSlopeMode(true);   // keep slope on for when the player returns to a course
  rangeTarget = parseInt(rangeSlider.value, 10);
  if (!rangeRec) {
    try {
      const r = await fetch("courses/range.json");
      if (!r.ok) throw new Error("HTTP " + r.status);
      rangeRec = await r.json();
    } catch (e) {
      console.warn("Range load failed, using synthetic range:", e);
      rangeRec = buildRangeRec(rangeTarget); // offline fallback
    }
  }
  setYardsPerUnit(rangeRec.yardsPerUnit);
  setHole(rangeRec);
  HOLE.isRange = true;
  // target ring at the chosen yardage straight up the range from the tee
  HOLE.holePos = { x: HOLE.teePos.x, y: HOLE.teePos.y - rangeTarget / YARDS_PER_UNIT };
  HOLE.yards = rangeTarget;
  frameRange();
  snapCamera();
  elHint.classList.add("hidden");   // setHole re-shows the hint; range uses its own feedback
  shot.carry = shot.total = null; shot.mph = 0;
  rangeFeedback("Aim up the range");
}

document.getElementById("play-course").addEventListener("click", openPlayMenu);
const _playDaily = document.getElementById("play-daily");
if (_playDaily) _playDaily.addEventListener("click", startDaily);
document.getElementById("play-range").addEventListener("click", startRange);
document.getElementById("range-menu-btn").addEventListener("click", showMenu);
rangeSlider.addEventListener("input", () => {
  rangeTarget = parseInt(rangeSlider.value, 10);
  elRangeYards.textContent = rangeTarget;
  if (mode === "range") {
    HOLE.holePos = { x: HOLE.teePos.x, y: HOLE.teePos.y - rangeTarget / YARDS_PER_UNIT };
    HOLE.yards = rangeTarget;
    frameRange();
    snapCamera();
  }
});

// =====================================================================
//  Leaderboard + Accounts — shared scores via Supabase REST (plain fetch).
//  Identity: real accounts via Supabase Auth (GoTrue) email magic link.
//  Guests can still play; login is required only to post scores / play
//  tournaments. Logged-in writes carry the user's access token so RLS
//  enforces user_id = auth.uid() (kills score-spoofing for accounts).
// =====================================================================
const LB_URL = "https://phexiylwltbyjvyujtql.supabase.co";   // Supabase Project URL
const LB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoZXhpeWx3bHRieWp2eXVqdHFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MzA2NzUsImV4cCI6MjA5ODAwNjY3NX0.Rf0ihIMxMjpCwKiNFHFGtyU9ZiSmkPinSRol2gRpofY";   // anon public key (safe to ship)
const LB_ON = () => /^https:\/\//.test(LB_URL) && LB_KEY.length > 20;
// Public/anon headers — used for reads and guest writes.
function lbHeaders(extra) {
  return Object.assign({ apikey: LB_KEY, Authorization: "Bearer " + LB_KEY,
                         "Content-Type": "application/json" }, extra || {});
}
// Authed headers — Bearer = user access token when logged in, else anon key.
function authHeaders(extra) {
  const s = getSession();
  const token = (s && s.access_token) ? s.access_token : LB_KEY;
  return Object.assign({ apikey: LB_KEY, Authorization: "Bearer " + token,
                         "Content-Type": "application/json" }, extra || {});
}

// =====================================================================
//  Auth (Supabase GoTrue REST) — magic link, session in localStorage.
// =====================================================================
function getSession() {
  try { return JSON.parse(localStorage.getItem("golf.session") || "null"); } catch (e) { return null; }
}
function setSession(s) {
  try { localStorage.setItem("golf.session", s ? JSON.stringify(s) : "null"); } catch (e) {}
}
function clearSession() { try { localStorage.removeItem("golf.session"); } catch (e) {} _profile = null; }
function isLoggedIn() { const s = getSession(); return !!(s && s.access_token && s.user); }
function currentUser() { const s = getSession(); return (s && s.user) ? s.user : null; }

// Persist tokens + user into the session store (expires_at in ms epoch).
function storeTokens(tok, user) {
  const expSec = tok.expires_at || (tok.expires_in ? Math.floor(Date.now() / 1000) + tok.expires_in : 0);
  setSession({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: expSec * 1000,
    user: user || (getSession() || {}).user || null,
  });
}

// Email an OTP code to the email (no magic link). Returns true on success.
// Digit count is a Supabase Auth dashboard setting (Authentication -> Providers
// -> Email -> OTP length), not controlled from this file — the client regex
// below just needs to accept whatever length is actually configured there.
// NOTE: we deliberately omit email_redirect_to — we verify the code via /verify
// (see verifyOtp), never a redirect link (broken on GitHub Pages). The email's
// link-vs-code content is controlled by the Supabase email TEMPLATES: both the
// "Confirm signup" (new users) and "Magic Link" (existing users) templates must
// use {{ .Token }} so the first send always shows a code, not a link.
async function sendMagicLink(email) {
  if (!LB_ON()) return false;
  try {
    const res = await fetch(LB_URL + "/auth/v1/otp", {
      method: "POST",
      headers: { apikey: LB_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: (email || "").trim(), create_user: true }),
    });
    return res.ok;
  } catch (e) { console.warn("OTP send failed:", e); return false; }
}

// Verify the emailed OTP code → returns a session with no redirect needed.
// Sidesteps magic-link redirect entirely. Returns true on success.
async function verifyOtp(email, code) {
  if (!LB_ON()) return false;
  try {
    const res = await fetch(LB_URL + "/auth/v1/verify", {
      method: "POST",
      headers: { apikey: LB_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "email", email: (email || "").trim(), token: (code || "").trim() }),
    });
    if (!res.ok) return false;
    const tok = await res.json();   // { access_token, refresh_token, user, ... }
    if (!tok.access_token) return false;
    storeTokens(tok, tok.user || null);
    track("signup_complete");
    return true;
  } catch (e) { console.warn("OTP verify failed:", e); return false; }
}

// On boot: if returning from a magic link, the tokens are in the URL hash.
function parseAuthRedirect() {
  if (!location.hash || location.hash.indexOf("access_token") === -1) return false;
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  const access_token = p.get("access_token");
  if (!access_token) return false;
  storeTokens({
    access_token,
    refresh_token: p.get("refresh_token"),
    expires_at: parseInt(p.get("expires_at") || "0", 10),
    expires_in: parseInt(p.get("expires_in") || "0", 10),
  }, null);
  // strip the hash so a refresh doesn't re-process stale tokens
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}

// Returns the user object, null if the token was explicitly rejected (401/403 —
// really logged out), or undefined on a transient failure (network/5xx) where
// we don't yet know and must NOT treat it as a sign-out.
async function fetchUser() {
  const s = getSession();
  if (!s || !s.access_token) return null;
  try {
    const res = await fetch(LB_URL + "/auth/v1/user", {
      headers: { apikey: LB_KEY, Authorization: "Bearer " + s.access_token },
    });
    if (res.ok) return res.json();   // { id, email, ... }
    if (res.status === 401 || res.status === 403) return null;
    return undefined;                // 5xx / rate limit — transient
  } catch (e) { return undefined; }  // offline / network error — transient
}

// Returns true on success, false otherwise. Only clears the session when the
// refresh token is explicitly rejected (400/401 — actually revoked/expired);
// a network error or server hiccup leaves the stored session alone so the
// next launch can retry instead of forcing a fresh OTP.
async function refreshSession() {
  const s = getSession();
  if (!s || !s.refresh_token) return false;
  let res;
  try {
    res = await fetch(LB_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: LB_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
  } catch (e) { return false; }      // offline / network error — transient
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) clearSession();
    return false;
  }
  const tok = await res.json();
  storeTokens(tok, tok.user || s.user);
  return true;
}

// Validate/restore the stored session; refresh if expired; confirm the user.
// Transient failures (offline, server hiccup) keep the existing session
// intact rather than forcing the player back through the OTP flow.
async function restoreSession() {
  let s = getSession();
  if (!s || !s.access_token) return false;
  if (s.expires_at && Date.now() > s.expires_at - 60000) {
    if (!(await refreshSession())) return isLoggedIn();
    s = getSession();
  }
  const user = await fetchUser();
  if (user === undefined) return isLoggedIn();  // transient — keep cached session
  if (user === null) {                          // token explicitly rejected — try one refresh
    if (!(await refreshSession())) return isLoggedIn();
    const u2 = await fetchUser();
    if (u2 === undefined) return isLoggedIn();
    if (u2 === null) { clearSession(); return false; }
    s = getSession(); s.user = u2; setSession(s); return true;
  }
  s.user = user; setSession(s);
  return true;
}

async function signOut() {
  const s = getSession();
  if (s && s.access_token && LB_ON()) {
    try { await fetch(LB_URL + "/auth/v1/logout", { method: "POST",
            headers: { apikey: LB_KEY, Authorization: "Bearer " + s.access_token } }); } catch (e) {}
  }
  clearSession();
  updateAuthUI();
}

// =====================================================================
//  Profiles — display name + admin flag per account.
// =====================================================================
let _profile = null;   // cached { id, display_name, is_admin }

async function fetchProfile(uid) {
  if (!LB_ON() || !uid) return null;
  try {
    const res = await fetch(LB_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(uid) + "&select=*",
                            { headers: lbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch (e) { return null; }
}

// After login: load the profile, create it if missing, prompt for a name if blank.
async function ensureProfile() {
  const u = currentUser();
  if (!u) { _profile = null; return; }
  let prof = await fetchProfile(u.id);
  if (!prof) {
    // create a row (RLS: auth.uid() = id). display_name from any cached guest name.
    const guessName = localStorage.getItem("golf.playerName") || "";
    try {
      const res = await fetch(LB_URL + "/rest/v1/profiles", {
        method: "POST", headers: authHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({ id: u.id, display_name: guessName || null }),
      });
      if (res.ok) { const rows = await res.json(); prof = rows[0] || { id: u.id, display_name: guessName }; }
    } catch (e) {}
    if (!prof) prof = { id: u.id, display_name: guessName, is_admin: false };
  }
  _profile = prof;
  if (prof.display_name) { try { localStorage.setItem("golf.playerName", prof.display_name); } catch (e) {} }
  mergeServerEntitlements(prof.entitlements);   // pull in courses booked from another device
  updateMenuPlayerLine();
  refreshFriendBadges();   // light up the Friends menu dot if requests/invites wait
  // first run with no name → prompt (reuses the name-entry overlay)
  if (!prof.display_name) openNameEntry(null);
}

async function saveDisplayName(name) {
  const u = currentUser();
  if (!u || !LB_ON()) return;
  try {
    await fetch(LB_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(u.id), {
      method: "PATCH", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ display_name: name }),
    });
    if (_profile) _profile.display_name = name;
  } catch (e) { console.warn("Save name failed:", e); }
}

// --- username: unique searchable handle (separate from the free-text name) ---
function validUsername(name) { return /^[a-z0-9_]{3,16}$/.test(name); }
function myUsername() { return (_profile && _profile.username) || ""; }

// Save a unique handle. Returns { ok:true } or { error:"…" }.
async function saveUsername(raw) {
  const u = currentUser();
  if (!u || !LB_ON()) return { error: "Sign in first." };
  const name = (raw || "").trim().toLowerCase();
  if (!validUsername(name)) return { error: "3–16 chars: a–z, 0–9, underscore." };
  try {
    const res = await fetch(LB_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(u.id), {
      method: "PATCH", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ username: name }),
    });
    if (res.status === 409) return { error: "That username is taken." };
    if (!res.ok) return { error: "Couldn't save. Try again." };
    if (_profile) _profile.username = name;
    return { ok: true };
  } catch (e) { return { error: "Network error." }; }
}

function isTournamentAdmin() { return !!(_profile && _profile.is_admin); }

// --- player name: profile display_name when logged in, else local guest name ---
function getPlayerName() {
  if (_profile && _profile.display_name) return _profile.display_name;
  try { return localStorage.getItem("golf.playerName") || ""; } catch (e) { return ""; }
}
function setPlayerName(n) {
  const clean = (n || "").trim().slice(0, 16);
  try { localStorage.setItem("golf.playerName", clean); } catch (e) { /* ignore */ }
  if (isLoggedIn()) saveDisplayName(clean);   // persist to the account
  updateMenuPlayerLine();
  return clean;
}
function updateMenuPlayerLine() {
  const el = document.getElementById("menu-player-name");
  if (el) el.textContent = getPlayerName() || "Set name";
  updateAuthUI();
}

// --- auth UI (menu control + magic-link modal) ---
function updateAuthUI() {
  const signin = document.getElementById("menu-signin");
  const account = document.getElementById("menu-account");
  if (!signin || !account) return;
  const on = isLoggedIn();
  signin.classList.toggle("hidden", on);
  account.classList.toggle("hidden", !on);
  const acctBtn = document.getElementById("open-account");
  if (acctBtn) acctBtn.classList.toggle("hidden", !on);
  const friendsBtn = document.getElementById("menu-friends");
  if (friendsBtn) friendsBtn.classList.toggle("hidden", !on);
  const adminBtn = document.getElementById("menu-admin");
  if (adminBtn) adminBtn.classList.toggle("hidden", !isTournamentAdmin());
  const manageBtn = document.getElementById("menu-manage");
  if (manageBtn) manageBtn.classList.toggle("hidden", !isTournamentAdmin());
  const addBtn = document.getElementById("menu-add-course");
  // "Add course" needs the local bake server (no /api on a static deploy) AND admin.
  if (addBtn) addBtn.classList.toggle("hidden", !(isTournamentAdmin() && _bakeApi));
}

// True once GET /api/ping succeeds (i.e. bake_server.py is serving). Probed at boot.
let _bakeApi = false;
async function probeBakeApi() {
  try {
    const res = await fetch("/api/ping", { cache: "no-store" });
    _bakeApi = res.ok && (await res.json()).ok === true;
  } catch (e) { _bakeApi = false; }
  updateAuthUI();
}

function openAuthModal() {
  const m = document.getElementById("auth-modal");
  if (!m) return;
  document.getElementById("auth-form").classList.remove("hidden");
  document.getElementById("auth-sent").classList.add("hidden");
  document.getElementById("auth-error").classList.add("hidden");
  m.classList.remove("hidden");
  const inp = document.getElementById("auth-email");
  if (inp) setTimeout(() => inp.focus(), 30);
}
function closeAuthModal() {
  const m = document.getElementById("auth-modal");
  if (m) m.classList.add("hidden");
}

(function wireAuth() {
  const signin = document.getElementById("menu-signin");
  if (signin) signin.addEventListener("click", openAuthModal);
  const signout = document.getElementById("menu-signout");
  if (signout) signout.addEventListener("click", async () => { await signOut(); updateMenuPlayerLine(); });

  const cancel = document.getElementById("auth-cancel");
  if (cancel) cancel.addEventListener("click", closeAuthModal);
  const sentClose = document.getElementById("auth-sent-close");
  if (sentClose) sentClose.addEventListener("click", closeAuthModal);

  const send = document.getElementById("auth-send");
  const email = document.getElementById("auth-email");
  const err = document.getElementById("auth-error");
  const code = document.getElementById("auth-code");
  const codeErr = document.getElementById("auth-code-error");
  const verify = document.getElementById("auth-verify");
  let _otpEmail = "";   // email the code was sent to (for verify)

  async function doSend() {
    const v = (email.value || "").trim();
    err.classList.add("hidden");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      err.textContent = "Enter a valid email."; err.classList.remove("hidden"); return;
    }
    const ageCk = document.getElementById("auth-age-ck");
    if (ageCk && !ageCk.checked) {
      err.textContent = "Please confirm you're 13 or older and accept the Terms.";
      err.classList.remove("hidden"); return;
    }
    if (!LB_ON()) {
      err.textContent = "Auth not configured (set LB_URL / LB_KEY)."; err.classList.remove("hidden"); return;
    }
    send.disabled = true; send.textContent = "Sending…";
    const ok = await sendMagicLink(v);
    send.disabled = false; send.textContent = "Send code";
    if (ok) {
      _otpEmail = v;
      document.getElementById("auth-sent-email").textContent = v;
      document.getElementById("auth-form").classList.add("hidden");
      document.getElementById("auth-sent").classList.remove("hidden");
      if (code) { code.value = ""; setTimeout(() => code.focus(), 30); }
    } else {
      err.textContent = "Could not send code. Try again."; err.classList.remove("hidden");
    }
  }

  async function doVerify() {
    const c = (code.value || "").trim();
    codeErr.classList.add("hidden");
    if (!/^\d{5,10}$/.test(c)) {
      codeErr.textContent = "Enter the code from your email."; codeErr.classList.remove("hidden"); return;
    }
    verify.disabled = true; verify.textContent = "Verifying…";
    const ok = await verifyOtp(_otpEmail, c);
    verify.disabled = false; verify.textContent = "Verify";
    if (ok) {
      closeAuthModal();
      if (isLoggedIn()) { await ensureProfile(); await flushPendingRounds(); }
      updateMenuPlayerLine();
    } else {
      codeErr.textContent = "Invalid or expired code."; codeErr.classList.remove("hidden");
    }
  }

  if (send) send.addEventListener("click", doSend);
  if (email) email.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
  if (verify) verify.addEventListener("click", doVerify);
  if (code) code.addEventListener("keydown", (e) => { if (e.key === "Enter") doVerify(); });
})();

// --- name-entry overlay (also used to gate submit) ---
let _namePending = null;   // callback to run once a name is saved
function openNameEntry(onSaved) {
  _namePending = onSaved || null;
  const ov = document.getElementById("name-entry");
  const inp = document.getElementById("ne-input");
  if (!ov || !inp) return;
  inp.value = getPlayerName();
  ov.classList.remove("hidden");
  setTimeout(() => inp.focus(), 30);
}
function closeNameEntry() {
  const ov = document.getElementById("name-entry");
  if (ov) ov.classList.add("hidden");
  _namePending = null;
}

// --- admin "Add course": search any course -> local bake server bakes it -----
let _acTimer = null, _acBaking = false;
function openAddCourse() {
  if (!(isTournamentAdmin() && _bakeApi)) return;
  const ov = document.getElementById("add-course");
  const inp = document.getElementById("ac-search");
  if (!ov || !inp) return;
  inp.value = "";
  document.getElementById("ac-results").innerHTML = "";
  document.getElementById("ac-progress").textContent = "";
  _acBaking = false;
  ov.classList.remove("hidden");
  setTimeout(() => inp.focus(), 30);
}
function closeAddCourse() {
  if (_acBaking) return;            // don't bail mid-bake
  const ov = document.getElementById("add-course");
  if (ov) ov.classList.add("hidden");
  clearTimeout(_acTimer);
}
function acOnInput() {
  clearTimeout(_acTimer);
  const q = document.getElementById("ac-search").value.trim();
  const host = document.getElementById("ac-results");
  if (q.length < 2) { host.innerHTML = ""; return; }
  _acTimer = setTimeout(() => acSearch(q), 600);   // gentle on Nominatim (~1 req/s fair-use)
}
async function acSearch(q) {
  const host = document.getElementById("ac-results");
  host.innerHTML = `<div class="ac-note">Searching…</div>`;
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(q), { cache: "no-store" });
    const list = res.ok ? await res.json() : [];
    if (!Array.isArray(list) || !list.length) {
      host.innerHTML = `<div class="ac-note">No golf courses found for “${q}”.</div>`;
      return;
    }
    host.innerHTML = "";
    for (const rec of list) {
      const b = document.createElement("button");
      b.className = "course-opt";
      b.innerHTML = `<span class="course-opt-name">${rec.name}</span><span class="course-opt-sub">${rec.sub}</span>`;
      b.addEventListener("click", () => acBake(rec));
      host.appendChild(b);
    }
  } catch (e) {
    host.innerHTML = `<div class="ac-note">Search failed: ${e.message}</div>`;
  }
}
async function acBake(rec) {
  if (_acBaking) return;
  _acBaking = true;
  const host = document.getElementById("ac-results");
  const prog = document.getElementById("ac-progress");
  host.innerHTML = `<div class="ac-note">Baking <b>${rec.name}</b>… ~3–10 min. Keep this open.</div>`;
  prog.textContent = "";
  try {
    const res = await fetch("/api/bake", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boundaryId: rec.boundaryId, kind: rec.kind, id: rec.id, name: rec.name, center: rec.center }),
    });
    if (!res.ok) {                          // 400/409/502 — JSON error, not a stream
      let msg = "HTTP " + res.status;
      try { msg = (await res.json()).error || msg; } catch (e) { /* ignore */ }
      host.innerHTML = `<div class="ac-note">Couldn’t bake: ${msg}</div>`;
      _acBaking = false; return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      prog.textContent = buf;
      prog.scrollTop = prog.scrollHeight;
    }
    const okM = buf.match(/__BAKE_OK__\s+(\{.*\})/);
    if (okM) {
      await loadManifest();
      selectedCourseId = rec.id;
      buildCourseList();
      host.innerHTML = `<div class="ac-note">✓ Added <b>${rec.name}</b> — selected in the course list.</div>`;
      _acBaking = false;
      setTimeout(closeAddCourse, 1400);
    } else {
      const failM = buf.match(/__BAKE_FAIL__\s+(.*)/);
      host.innerHTML = `<div class="ac-note">Bake failed${failM ? ": " + failM[1] : ""}. See log below.</div>`;
      _acBaking = false;
    }
  } catch (e) {
    host.innerHTML = `<div class="ac-note">Bake error: ${e.message}</div>`;
    _acBaking = false;
  }
}

// --- build a leaderboard row from the finished round ---
function buildRoundPayload() {
  const stats = round.holeStats, n = stats.length;
  if (!n || !course) return null;
  const girs = stats.filter(h => h.gir).length;
  const firHoles = stats.filter(h => h.fairwayHit !== null);
  const firs = firHoles.filter(h => h.fairwayHit).length;
  const putts = stats.reduce((s, h) => s + (h.putts || 0), 0);
  const proxHoles = stats.filter(h => h.proximity !== null);
  const avgProx = proxHoles.length ? proxHoles.reduce((s, h) => s + h.proximity, 0) / proxHoles.length : null;
  const strokes = stats.reduce((s, h) => s + h.strokes, 0);
  // Daily forms its own date-keyed board (single hole), no schema change.
  const courseId = dailyMode ? ("daily_" + ((dailyInfo && dailyInfo.date) || todayStr())) : selectedCourseId;
  const holeCount = dailyMode ? 1 : course.holes.length;
  return {
    name: getPlayerName(), user_id: (currentUser() || {}).id || null,
    course_id: courseId, hole_count: holeCount,
    strokes, to_par: round.score, putts, gir: girs,
    fir: firs, fir_holes: firHoles.length,
    prox_ft: avgProx !== null ? Math.round(avgProx * 3) : null,
  };
}

async function submitRound(payload) {
  if (!LB_ON() || !payload || !payload.name) return false;
  try {
    const res = await fetch(LB_URL + "/rest/v1/rounds", {
      method: "POST", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) { console.warn("Leaderboard submit failed:", e); return false; }
}

// --- Pending-submission queue (handles the magic-link redirect gap) ---
// A round finished while logged out is stashed here; logging in reloads the
// page, and flushPendingRounds() posts the queue once a session is restored.
function getPendingRounds() {
  try { return JSON.parse(localStorage.getItem("golf.pendingRounds") || "[]"); } catch (e) { return []; }
}
function setPendingRounds(arr) {
  try { localStorage.setItem("golf.pendingRounds", JSON.stringify(arr || [])); } catch (e) {}
}
function queuePendingRound(payload) {
  const q = getPendingRounds();
  q.push(payload);
  setPendingRounds(q);
}
async function flushPendingRounds() {
  if (!LB_ON() || !isLoggedIn()) return;
  const q = getPendingRounds();
  if (!q.length) return;
  const uid = (currentUser() || {}).id || null;
  const remaining = [];
  for (const p of q) {
    p.user_id = uid;                 // attach the now-known account
    p.name = getPlayerName() || p.name;
    const ok = await submitRound(p);
    if (!ok) remaining.push(p);
  }
  setPendingRounds(remaining);
}

// Called when a round completes. Posts immediately — name-only for guests
// (no login required); a set name is all that's needed to land on the board.
function submitFinishedRound() {
  if (!LB_ON() || round._submitted) return;
  round._submitted = true;
  const payload = buildRoundPayload();
  if (!payload) return;
  track("round_complete", { course: payload.course_id, holes: payload.hole_count,
    strokes: payload.strokes, to_par: payload.to_par, signed_in: !!payload.user_id });
  const btn = document.getElementById("re-leaderboard");
  const post = () => {
    payload.name = getPlayerName();   // pick up a name set just now
    submitRound(payload).then(ok => {
      if (btn && ok) btn.textContent = "View leaderboard ✓";
      if (ok) refreshMyHandicap();    // keep the Quick Match pairing rating fresh
    });
  };
  if (payload.name) post();
  else openNameEntry(post);           // no name yet → prompt, then post
}

async function fetchLeaderboard(courseId) {
  if (!LB_ON()) return null;
  const q = "/rest/v1/rounds?course_id=eq." + encodeURIComponent(courseId) +
            "&order=to_par.asc,strokes.asc&limit=200";
  const res = await fetch(LB_URL + q, { headers: lbHeaders() });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const rows = await res.json();
  // best round per account (already sorted best-first); key by user_id when
  // present (real account), else fall back to name (legacy/guest rows).
  const seen = new Set(), best = [];
  for (const r of rows) {
    const key = r.user_id ? ("u:" + r.user_id) : ("n:" + (r.name || "").toLowerCase());
    if (seen.has(key)) continue;
    seen.add(key); best.push(r);
  }
  return best.slice(0, 50);
}

let _lbCourseId = null;
async function renderLeaderboard(courseId) {
  _lbCourseId = courseId;
  const list = document.getElementById("lb-list");
  const empty = document.getElementById("lb-empty");
  if (!list) return;
  // course selector reflects choice
  const sel = document.getElementById("lb-course");
  if (sel) sel.value = courseId;
  list.innerHTML = "";
  empty.textContent = "Loading…"; empty.classList.remove("hidden");
  if (!LB_ON()) { empty.textContent = "Leaderboard not configured."; return; }
  try {
    const rows = await fetchLeaderboard(courseId);
    if (!rows || !rows.length) { empty.textContent = "No scores yet — be the first!"; return; }
    const me = getPlayerName().toLowerCase();
    list.innerHTML = rows.map((r, i) => {
      const cls = r.to_par < 0 ? "under" : r.to_par > 0 ? "over" : "even";
      const mine = (r.name || "").toLowerCase() === me ? " lb-me" : "";
      return `<tr class="${mine}">
        <td class="lb-rank">${i + 1}</td>
        <td class="lb-name">${escapeHTML(r.name)}</td>
        <td class="lb-topar ${cls}">${formatToPar(r.to_par)}</td>
        <td class="lb-strk">${r.strokes}</td></tr>`;
    }).join("");
    empty.classList.add("hidden");
  } catch (e) {
    console.warn(e); empty.textContent = "Leaderboard unavailable.";
  }
}
function escapeHTML(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// (Re)fill the leaderboard course dropdown from the CURRENT COURSES list. Must
// run at open time, not parse time — the manifest (Butterbrook etc.) loads async
// after the page, so a parse-time build only ever shows the fallback courses.
function populateLbCourses() {
  const sel = document.getElementById("lb-course");
  if (!sel) return;
  const today = todayStr();
  const daily = `<option value="daily_${today}">Daily Challenge (${today})</option>`;
  sel.innerHTML = daily + visibleCourses().map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

let _lbReturn = "menu";  // where Close goes back to
function openLeaderboard(from) {
  _lbReturn = from || "menu";
  populateLbCourses();
  document.getElementById("leaderboard").classList.remove("hidden");
  renderLeaderboard(_lbCourseId || selectedCourseId);
}
function closeLeaderboard() {
  document.getElementById("leaderboard").classList.add("hidden");
  if (_lbReturn === "round-end") document.getElementById("round-end").classList.remove("hidden");
}

// =====================================================================
//  Account viewer — personal stats dashboard (logged-in only).
//  All numbers are computed client-side from rows already stored in
//  Supabase (rounds + tournament_rounds), keyed by the account user_id.
// =====================================================================
function courseName(id) {
  const c = COURSES.find((c) => c.id === id);
  return c ? c.name : id;
}

async function fetchMyRounds() {
  const u = currentUser();
  if (!LB_ON() || !u) return [];
  const q = "/rest/v1/rounds?user_id=eq." + encodeURIComponent(u.id) +
            "&order=created_at.desc&limit=500";
  const res = await fetch(LB_URL + q, { headers: lbHeaders() });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}

async function fetchMyTournamentRounds() {
  const u = currentUser();
  if (!LB_ON() || !u) return [];
  const q = "/rest/v1/tournament_rounds?user_id=eq." + encodeURIComponent(u.id) +
            "&order=submitted_at.desc&limit=200";
  const res = await fetch(LB_URL + q, { headers: lbHeaders() });
  if (!res.ok) return [];
  return await res.json();
}

// Aggregate a player's rounds into the dashboard numbers.
function computeMyStats(rounds) {
  const n = rounds.length;
  const s = {
    rounds: n, courses: 0, totalStrokes: 0,
    avgToPar: null, best: null, handicap: null,
    avgPutts: null, girPct: null, firPct: null, avgProx: null,
    byCourse: [],
  };
  if (!n) return s;

  const courseSet = new Set();
  let parSum = 0, strokeSum = 0;
  let puttSum = 0, puttN = 0;
  let girHit = 0, girHoles = 0;
  let firHit = 0, firHoles = 0;
  let proxSum = 0, proxN = 0;
  const byCourse = new Map();   // course_id -> best row

  for (const r of rounds) {
    courseSet_add(courseSet, r.course_id);
    parSum += r.to_par || 0;
    strokeSum += r.strokes || 0;
    if (r.putts != null) { puttSum += r.putts; puttN++; }
    if (r.gir != null && r.hole_count) { girHit += r.gir; girHoles += r.hole_count; }
    if (r.fir != null && r.fir_holes) { firHit += r.fir; firHoles += r.fir_holes; }
    if (r.prox_ft != null) { proxSum += r.prox_ft; proxN++; }
    if (!s.best || r.to_par < s.best.to_par ||
        (r.to_par === s.best.to_par && (r.strokes || 0) < (s.best.strokes || 0))) s.best = r;
    const b = byCourse.get(r.course_id);
    if (!b || r.to_par < b.to_par || (r.to_par === b.to_par && (r.strokes || 0) < (b.strokes || 0)))
      byCourse.set(r.course_id, r);
  }

  s.courses = courseSet.size;
  s.totalStrokes = strokeSum;
  s.avgToPar = parSum / n;
  if (puttN) s.avgPutts = puttSum / puttN;
  if (girHoles) s.girPct = (girHit / girHoles) * 100;
  if (firHoles) s.firPct = (firHit / firHoles) * 100;
  if (proxN) s.avgProx = proxSum / proxN;

  // Handicap estimate: avg of the best 8 to-par of the most recent 20 rounds.
  const recent = rounds.slice(0, 20).map((r) => r.to_par || 0).sort((a, b) => a - b);
  const take = Math.max(1, Math.min(8, recent.length));
  s.handicap = recent.slice(0, take).reduce((a, b) => a + b, 0) / take;

  s.byCourse = [...byCourse.values()].sort((a, b) => a.to_par - b.to_par);
  return s;
}
function courseSet_add(set, id) { if (id) set.add(id); }

function fmtAvg(v, d) { return v == null ? "—" : v.toFixed(d == null ? 1 : d); }
function fmtSignedAvg(v) { return v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1); }
function dateShort(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  return isNaN(dt) ? "" : (dt.getMonth() + 1) + "/" + dt.getDate() + "/" + String(dt.getFullYear()).slice(2);
}
function toparCell(v) {
  const cls = v < 0 ? "under" : v > 0 ? "over" : "even";
  return `<span class="${cls}">${formatToPar(v)}</span>`;
}

function renderAccount(stats, trounds) {
  const body = document.getElementById("av-body");
  if (!body) return;
  const u = currentUser();
  const name = getPlayerName() || "—";
  const email = u ? u.email : "";
  const joined = _profile && _profile.created_at ? dateShort(_profile.created_at) : "";
  const adminBadge = isTournamentAdmin() ? ` <span class="av-badge">ADMIN</span>` : "";

  const uname = myUsername() ? "@" + myUsername() : "Set username";
  const idHtml = `
    <div class="av-id">
      <div class="av-name">${escapeHTML(name)} <button id="av-editname" class="av-edit" title="Edit name"><span class="ic ic-pencil"></span></button>${adminBadge}</div>
      <div class="av-uname">${escapeHTML(uname)} <button id="av-edituname" class="av-edit" title="Set username"><span class="ic ic-pencil"></span></button></div>
      ${email ? `<div class="av-email">${escapeHTML(email)}</div>` : ""}
      ${joined ? `<div class="av-joined">Member since ${joined}</div>` : ""}
    </div>`;

  if (!stats.rounds) {
    body.innerHTML = idHtml + `<div class="av-empty">No rounds yet — play one and your stats appear here.</div>`;
    wireAvEditName();
    return;
  }

  const cell = (label, val) => `<div class="av-cell"><div class="av-val">${val}</div><div class="av-lbl">${label}</div></div>`;
  const totals = `
    <div class="av-grid">
      ${cell("Rounds", stats.rounds)}
      ${cell("Courses", stats.courses)}
      ${cell("Avg score", fmtSignedAvg(stats.avgToPar))}
      ${cell("Handicap", "<span class='av-hcp'>" + fmtSignedAvg(stats.handicap) + "</span><small> est.</small>")}
    </div>`;

  const bestRow = stats.best
    ? `<div class="av-best">Best round: <b>${toparCell(stats.best.to_par)}</b> · ${stats.best.strokes} strokes · ${escapeHTML(courseName(stats.best.course_id))}</div>`
    : "";

  const detail = `
    <div class="av-grid av-grid-4">
      ${cell("Putts/rd", fmtAvg(stats.avgPutts))}
      ${cell("GIR", stats.girPct == null ? "—" : Math.round(stats.girPct) + "%")}
      ${cell("FIR", stats.firPct == null ? "—" : Math.round(stats.firPct) + "%")}
      ${cell("Prox", stats.avgProx == null ? "—" : Math.round(stats.avgProx) + " ft")}
    </div>`;

  const byCourse = stats.byCourse.length ? `
    <div class="av-section">Best by course</div>
    <table class="lb-table av-table">
      <thead><tr><th>Course</th><th>Best</th><th>Strokes</th></tr></thead>
      <tbody>${stats.byCourse.map((r) => `
        <tr><td>${escapeHTML(courseName(r.course_id))}</td>
        <td class="lb-topar">${toparCell(r.to_par)}</td>
        <td class="lb-strk">${r.strokes}</td></tr>`).join("")}
      </tbody>
    </table>` : "";

  const recent = `
    <div class="av-section">Recent rounds</div>
    <table class="lb-table av-table">
      <thead><tr><th>Date</th><th>Course</th><th>Score</th><th>Strk</th><th>Putts</th></tr></thead>
      <tbody>${stats._recent.map((r) => `
        <tr><td class="av-date">${dateShort(r.created_at)}</td>
        <td>${escapeHTML(courseName(r.course_id))}</td>
        <td class="lb-topar">${toparCell(r.to_par)}</td>
        <td class="lb-strk">${r.strokes}</td>
        <td class="lb-strk">${r.putts == null ? "—" : r.putts}</td></tr>`).join("")}
      </tbody>
    </table>`;

  const trn = (trounds && trounds.length) ? `
    <div class="av-section">Tournament results</div>
    <table class="lb-table av-table">
      <thead><tr><th>Date</th><th>Round</th><th>Score</th><th>Strk</th></tr></thead>
      <tbody>${trounds.map((t) => `
        <tr><td class="av-date">${dateShort(t.submitted_at)}</td>
        <td>R${t.round_num}</td>
        <td class="lb-topar">${toparCell(t.to_par)}</td>
        <td class="lb-strk">${t.strokes}</td></tr>`).join("")}
      </tbody>
    </table>` : "";

  body.innerHTML = idHtml + totals + bestRow + detail + byCourse + recent + trn;
  wireAvEditName();
}
function wireAvEditName() {
  const e = document.getElementById("av-editname");
  if (e) e.addEventListener("click", () => openNameEntry(() => openAccountViewer()));
  const eu = document.getElementById("av-edituname");
  if (eu) eu.addEventListener("click", () => openUsernamePrompt(() => openAccountViewer()));
}

async function openAccountViewer() {
  if (!isLoggedIn()) { openAuthModal(); return; }
  const ov = document.getElementById("account-viewer");
  const body = document.getElementById("av-body");
  if (!ov || !body) return;
  ov.classList.remove("hidden");
  body.innerHTML = `<div class="av-empty">Loading…</div>`;
  try {
    const [rounds, trounds] = await Promise.all([fetchMyRounds(), fetchMyTournamentRounds()]);
    const stats = computeMyStats(rounds);
    stats._recent = rounds.slice(0, 12);
    renderAccount(stats, trounds);
  } catch (e) {
    console.warn(e);
    body.innerHTML = `<div class="av-empty">Couldn't load your stats. Try again.</div>`;
  }
}
function closeAccountViewer() {
  const ov = document.getElementById("account-viewer");
  if (ov) ov.classList.add("hidden");
}
(function wireAccountViewer() {
  const open = document.getElementById("open-account");
  if (open) open.addEventListener("click", openAccountViewer);
  const close = document.getElementById("av-close");
  if (close) close.addEventListener("click", closeAccountViewer);
  const out = document.getElementById("av-signout");
  if (out) out.addEventListener("click", async () => { await signOut(); closeAccountViewer(); updateMenuPlayerLine(); });
  const del = document.getElementById("av-delete");
  if (del) del.addEventListener("click", deleteMyAccount);
})();

// Self-serve account + data deletion (privacy.html / COPPA/GDPR right-to-erasure).
// Tries the delete_account() RPC first (removes the auth user + all rows in one
// server-side transaction; see schema.sql); falls back to deleting the user's own
// rows directly under per-row RLS. Either way the local session is cleared.
async function deleteMyAccount() {
  const u = currentUser();
  if (!LB_ON() || !u || !u.id) { showToast("Not signed in", 2000); return; }
  if (!confirm("Delete your account and ALL your scores? This can't be undone.")) return;
  if (!confirm("Are you sure? This permanently removes your data.")) return;
  const del = document.getElementById("av-delete");
  if (del) { del.disabled = true; del.textContent = "Deleting…"; }
  let ok = false;
  try {
    // Preferred: one server-side transaction that also removes the auth user.
    const r = await fetch(LB_URL + "/rest/v1/rpc/delete_account", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}",
    });
    ok = r.ok;
    if (!ok) {
      // Fallback: delete my own rows directly (RLS scopes these to me).
      for (const path of [`rounds?user_id=eq.${u.id}`, `profiles?id=eq.${u.id}`]) {
        await fetch(LB_URL + "/rest/v1/" + path, { method: "DELETE", headers: authHeaders({ Prefer: "return=minimal" }) });
      }
      ok = true;
    }
  } catch (e) { console.warn("account delete failed:", e); }
  if (del) { del.disabled = false; del.textContent = "Delete account & data"; }
  await signOut();
  closeAccountViewer();
  updateMenuPlayerLine();
  showToast(ok ? "Account and data deleted" : "Signed out — email us to finish deletion", 3000);
}

// =====================================================================
//  Friends — unique-handle friend graph (request → accept), friend
//  profiles with head-to-head W/L, and direct match invites. Backed by the
//  `friendships` + `match_invites` tables (see schema.sql). All reads/writes
//  carry the user token (authHeaders) so per-row RLS scopes them to me.
// =====================================================================
let _friends = { accepted: [], incoming: [], outgoing: [] };  // last fetch
let _friendsPoll = null;
let _frTab = "list";
let _frProfileUid = null;   // friend currently viewed
let _frProfileFid = null;   // their friendship row id (for unfriend)

function myUid() { return (currentUser() || {}).id || null; }

// Resolve a handle → { id, username, display_name } (or null).
async function findUserByUsername(name) {
  const clean = (name || "").trim().toLowerCase();
  if (!LB_ON() || !validUsername(clean)) return null;
  try {
    const q = "/rest/v1/profiles?username=eq." + encodeURIComponent(clean) +
              "&select=id,username,display_name";
    const res = await fetch(LB_URL + q, { headers: lbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch (e) { return null; }
}

// Resolve user ids → { id: {username, display_name} }.
async function fetchProfilesByIds(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!LB_ON() || !uniq.length) return {};
  try {
    const list = uniq.map(encodeURIComponent).join(",");
    const q = "/rest/v1/profiles?id=in.(" + list + ")&select=id,username,display_name";
    const res = await fetch(LB_URL + q, { headers: lbHeaders() });
    if (!res.ok) return {};
    const m = {};
    for (const r of await res.json()) m[r.id] = r;
    return m;
  } catch (e) { return {}; }
}

// Every friendship touching me, split by status/direction, names resolved.
async function fetchFriendships() {
  const uid = myUid();
  const empty = { accepted: [], incoming: [], outgoing: [] };
  if (!LB_ON() || !uid) return empty;
  try {
    const q = "/rest/v1/friendships?or=(requester.eq." + encodeURIComponent(uid) +
              ",addressee.eq." + encodeURIComponent(uid) + ")";
    const res = await fetch(LB_URL + q, { headers: authHeaders() });
    if (!res.ok) return empty;
    const rows = await res.json();
    const profs = await fetchProfilesByIds(rows.map(r => r.requester === uid ? r.addressee : r.requester));
    const out = { accepted: [], incoming: [], outgoing: [] };
    for (const r of rows) {
      const otherId = r.requester === uid ? r.addressee : r.requester;
      const p = profs[otherId] || {};
      const entry = { id: r.id, uid: otherId, status: r.status,
                      username: p.username || "", display_name: p.display_name || "" };
      if (r.status === "accepted") out.accepted.push(entry);
      else if (r.addressee === uid) out.incoming.push(entry);
      else out.outgoing.push(entry);
    }
    _friends = out;
    return out;
  } catch (e) { return empty; }
}

// Send a friend request to a resolved profile id. Dedupes either direction.
async function sendFriendRequest(addresseeId) {
  const uid = myUid();
  if (!LB_ON() || !uid) return { error: "Sign in first." };
  if (addresseeId === uid) return { error: "That's you." };
  await fetchFriendships();   // refresh cache so dedupe is accurate
  const all = [..._friends.accepted, ..._friends.incoming, ..._friends.outgoing];
  if (all.some(f => f.uid === addresseeId)) return { error: "Already connected or pending." };
  try {
    const res = await fetch(LB_URL + "/rest/v1/friendships", {
      method: "POST", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ requester: uid, addressee: addresseeId, status: "pending" }),
    });
    if (res.status === 409) return { error: "Already requested." };
    if (!res.ok) return { error: "Couldn't send. Try again." };
    return { ok: true };
  } catch (e) { return { error: "Network error." }; }
}

async function acceptRequest(id) {
  if (!LB_ON() || !id) return false;
  try {
    const res = await fetch(LB_URL + "/rest/v1/friendships?id=eq." + encodeURIComponent(id), {
      method: "PATCH", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ status: "accepted", updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch (e) { return false; }
}

async function removeFriendship(id) {   // covers decline / cancel / unfriend
  if (!LB_ON() || !id) return false;
  try {
    const res = await fetch(LB_URL + "/rest/v1/friendships?id=eq." + encodeURIComponent(id),
                            { method: "DELETE", headers: authHeaders({ Prefer: "return=minimal" }) });
    return res.ok;
  } catch (e) { return false; }
}

// Head-to-head record vs a friend across finished matches we both played.
async function computeHeadToHead(friendUid) {
  const uid = myUid();
  const rec = { wins: 0, losses: 0, halves: 0, played: 0 };
  if (!LB_ON() || !uid || !friendUid) return rec;
  const sel = "&select=match_id,score,hole_scores,finished,match:matches(format,hole_count,status)";
  async function rowsFor(id) {
    const q = "/rest/v1/match_players?user_id=eq." + encodeURIComponent(id) + sel;
    const res = await fetch(LB_URL + q, { headers: authHeaders() });
    return res.ok ? res.json() : [];
  }
  let meRows, themRows;
  try { [meRows, themRows] = await Promise.all([rowsFor(uid), rowsFor(friendUid)]); }
  catch (e) { return rec; }
  const themByMatch = {};
  for (const r of themRows) themByMatch[r.match_id] = r;
  for (const me of meRows) {
    const opp = themByMatch[me.match_id];
    if (!opp) continue;
    const m = me.match || {};
    if (m.status !== "done") continue;
    rec.played++;
    let r;   // +1 I win, -1 I lose, 0 halve
    if (m.format === "match") r = Math.sign(computeMatchPlay(me, opp, m.hole_count || 18).diff);
    else r = Math.sign((opp.score | 0) - (me.score | 0));   // stroke: lower wins
    if (r > 0) rec.wins++; else if (r < 0) rec.losses++; else rec.halves++;
  }
  return rec;
}

// Rounds for an arbitrary account (friend profiles reuse the stat pipeline).
async function fetchRoundsFor(uid) {
  if (!LB_ON() || !uid) return [];
  const q = "/rest/v1/rounds?user_id=eq." + encodeURIComponent(uid) + "&order=created_at.desc&limit=500";
  const res = await fetch(LB_URL + q, { headers: lbHeaders() });
  return res.ok ? res.json() : [];
}

// ---- match invites ----
async function fetchMyInvites() {
  const uid = myUid();
  if (!LB_ON() || !uid) return [];
  try {
    const q = "/rest/v1/match_invites?to_user=eq." + encodeURIComponent(uid) +
              "&status=eq.pending&order=created_at.desc";
    const res = await fetch(LB_URL + q, { headers: authHeaders() });
    if (!res.ok) return [];
    const rows = await res.json();
    const profs = await fetchProfilesByIds(rows.map(r => r.from_user));
    return rows.map(r => Object.assign({}, r, {
      from_name: (profs[r.from_user] || {}).display_name || (profs[r.from_user] || {}).username || "A friend" }));
  } catch (e) { return []; }
}

async function inviteFriendToMatch(friendUid) {
  if (!friendUid || !LB_ON()) return;
  const btn = document.getElementById("fp-invite");
  if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }
  const m = await createMatch();          // reuse the normal host flow
  if (!m) { if (btn) { btn.disabled = false; btn.textContent = "Invite to match"; } return; }
  await addMatchPlayer(m.id);
  activeMatch = m; _matchIsHost = true; _matchEntered = false;
  try {
    await fetch(LB_URL + "/rest/v1/match_invites", {
      method: "POST", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ match_id: m.id, code: m.code, from_user: myUid(), to_user: friendUid, status: "pending" }),
    });
    track("friend_challenge_sent");
  } catch (e) {}
  if (btn) { btn.disabled = false; btn.textContent = "Invite to match"; }
  closeFriendProfile(); closeFriends();
  openMatchLobby();                        // host waits in the lobby
}

async function acceptInvite(inviteId, code) {
  if (!LB_ON() || !code) return;
  if (inviteId) {
    try { await fetch(LB_URL + "/rest/v1/match_invites?id=eq." + encodeURIComponent(inviteId), {
      method: "PATCH", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ status: "accepted" }) }); } catch (e) {}
  }
  const m = await fetchMatchByCode((code || "").toUpperCase());   // join by code
  if (!m || m.status !== "lobby") { renderFriends(); return; }
  if (!(await addMatchPlayer(m.id))) return;
  activeMatch = m;
  _matchIsHost = (currentUser() && m.host_user_id === currentUser().id);
  _matchEntered = false;
  closeFriends();
  openMatchLobby();
}

async function declineInvite(inviteId) {
  if (!LB_ON() || !inviteId) return;
  try { await fetch(LB_URL + "/rest/v1/match_invites?id=eq." + encodeURIComponent(inviteId), {
    method: "PATCH", headers: authHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ status: "declined" }) }); } catch (e) {}
}

// ---- Friends UI ----
function frLabel(e) {
  const h = e.username ? "@" + esc(e.username) : "";
  const dn = e.display_name ? esc(e.display_name) : "";
  if (dn && h) return `${dn} <span class="fr-handle">${h}</span>`;
  return dn || h || "player";
}

function openFriends() {
  if (!isLoggedIn()) { openAuthModal(); return; }
  if (!myUsername()) { openUsernamePrompt(() => openFriends()); return; }   // need a handle first
  const ov = document.getElementById("friends-modal");
  if (!ov) return;
  ov.classList.remove("hidden");
  _frTab = "list";
  renderFriends();
  stopFriendsPoll();
  _friendsPoll = setInterval(() => { if (_frTab !== "add") renderFriends(); }, 4000);
}
function closeFriends() {
  stopFriendsPoll();
  const ov = document.getElementById("friends-modal");
  if (ov) ov.classList.add("hidden");
  refreshFriendBadges();
}
function stopFriendsPoll() { if (_friendsPoll) { clearInterval(_friendsPoll); _friendsPoll = null; } }

async function renderFriends() {
  const body = document.getElementById("fr-body");
  if (!body) return;
  document.querySelectorAll("#friends-modal .fr-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === _frTab));
  if (_frTab === "add") { renderFriendAdd(body); return; }
  const f = await fetchFriendships();
  updateReqBadge(f.incoming.length);
  if (_frTab === "requests") { renderFriendRequests(body, f); return; }
  const invites = await fetchMyInvites();
  renderFriendList(body, f, invites);
}

function renderFriendList(body, f, invites) {
  let html = "";
  if (invites && invites.length) {
    html += `<div class="av-section">Match invites</div>` + invites.map(iv =>
      `<div class="fr-row"><span class="fr-row-name">${esc(iv.from_name)} invited you</span>
        <span class="fr-row-act">
          <button class="fr-mini fr-join" data-inv="${iv.id}" data-code="${esc(iv.code)}">Join</button>
          <button class="fr-mini secondary fr-decline-inv" data-inv="${iv.id}"><span class="ic ic-x"></span></button>
        </span></div>`).join("");
  }
  html += `<div class="av-section">Friends (${f.accepted.length})</div>`;
  html += f.accepted.length
    ? f.accepted.map(e =>
        `<div class="fr-row"><span class="fr-row-name">${frLabel(e)}</span>
          <span class="fr-row-act"><button class="fr-mini fr-view" data-uid="${e.uid}" data-fid="${e.id}">View</button></span>
        </div>`).join("")
    : `<div class="av-empty">No friends yet. Use the Add tab to find people by username.</div>`;
  body.innerHTML = html;
}

function renderFriendRequests(body, f) {
  let html = `<div class="av-section">Incoming</div>`;
  html += f.incoming.length
    ? f.incoming.map(e =>
        `<div class="fr-row"><span class="fr-row-name">${frLabel(e)}</span>
          <span class="fr-row-act">
            <button class="fr-mini fr-accept" data-fid="${e.id}">Accept</button>
            <button class="fr-mini secondary fr-decline" data-fid="${e.id}">Decline</button>
          </span></div>`).join("")
    : `<div class="av-empty">No incoming requests.</div>`;
  html += `<div class="av-section">Sent</div>`;
  html += f.outgoing.length
    ? f.outgoing.map(e =>
        `<div class="fr-row"><span class="fr-row-name">${frLabel(e)}</span>
          <span class="fr-row-act"><button class="fr-mini secondary fr-cancel" data-fid="${e.id}">Cancel</button></span>
        </div>`).join("")
    : `<div class="av-empty">No pending sent requests.</div>`;
  body.innerHTML = html;
}

function renderFriendAdd(body) {
  body.innerHTML = `
    <p class="ne-sub" style="margin:8px 0">Find a player by their username.</p>
    <input id="fr-search" type="text" placeholder="username" maxlength="16" autocomplete="off" autocapitalize="off" autocorrect="off">
    <button id="fr-search-btn" class="menu-btn" style="margin-top:8px">Search</button>
    <div id="fr-search-result"></div>`;
  const inp = document.getElementById("fr-search");
  const out = document.getElementById("fr-search-result");
  async function doSearch() {
    const v = (inp.value || "").trim().toLowerCase();
    out.innerHTML = "";
    if (!validUsername(v)) { out.innerHTML = `<div class="fr-err">3–16 chars: a–z, 0–9, underscore.</div>`; return; }
    out.innerHTML = `<div class="av-empty">Searching…</div>`;
    const p = await findUserByUsername(v);
    if (!p) { out.innerHTML = `<div class="av-empty">No player @${esc(v)}.</div>`; return; }
    if (p.id === myUid()) { out.innerHTML = `<div class="av-empty">That's you!</div>`; return; }
    out.innerHTML =
      `<div class="fr-row"><span class="fr-row-name">${p.display_name ? esc(p.display_name) + " " : ""}<span class="fr-handle">@${esc(p.username)}</span></span>
        <span class="fr-row-act"><button id="fr-send" class="fr-mini">Add friend</button></span></div>
       <div id="fr-send-msg"></div>`;
    document.getElementById("fr-send").addEventListener("click", async () => {
      const msg = document.getElementById("fr-send-msg");
      msg.innerHTML = `<div class="av-empty">Sending…</div>`;
      const r = await sendFriendRequest(p.id);
      msg.innerHTML = r.ok ? `<div class="fr-ok">Request sent.</div>` : `<div class="fr-err">${esc(r.error)}</div>`;
    });
  }
  const btn = document.getElementById("fr-search-btn");
  if (btn) btn.addEventListener("click", doSearch);
  if (inp) { inp.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); }); setTimeout(() => inp.focus(), 30); }
}

function updateReqBadge(n) {
  const b = document.getElementById("fr-req-badge");
  if (!b) return;
  b.textContent = n; b.classList.toggle("hidden", !n);
}
// Light the menu dot when requests or invites are waiting (called on login + close).
async function refreshFriendBadges() {
  const dot = document.getElementById("fr-menu-dot");
  if (!LB_ON() || !myUid()) { if (dot) dot.classList.add("hidden"); return; }
  try {
    const [f, inv] = await Promise.all([fetchFriendships(), fetchMyInvites()]);
    const n = f.incoming.length + inv.length;
    if (dot) dot.classList.toggle("hidden", !n);
  } catch (e) {}
}

// ---- Friend profile (reuses computeMyStats + the account-stat layout) ----
async function openFriendProfile(uid, fid) {
  _frProfileUid = uid; _frProfileFid = fid;
  const ov = document.getElementById("friend-profile");
  const body = document.getElementById("fp-body");
  const title = document.getElementById("fp-name");
  if (!ov || !body) return;
  const f = _friends.accepted.find(e => e.uid === uid) || {};
  if (title) title.innerHTML = `<span class="ic ic-user"></span>${esc(f.display_name || ("@" + (f.username || "player")))}`;
  ov.classList.remove("hidden");
  body.innerHTML = `<div class="av-empty">Loading…</div>`;
  try {
    const [rounds, h2h] = await Promise.all([fetchRoundsFor(uid), computeHeadToHead(uid)]);
    const stats = computeMyStats(rounds);
    stats._recent = rounds.slice(0, 8);
    renderFriendProfile(body, stats, h2h, f);
  } catch (e) {
    body.innerHTML = `<div class="av-empty">Couldn't load this profile.</div>`;
  }
}
function closeFriendProfile() {
  const ov = document.getElementById("friend-profile");
  if (ov) ov.classList.add("hidden");
}

function renderFriendProfile(body, stats, h2h, f) {
  const cell = (label, val) => `<div class="av-cell"><div class="av-val">${val}</div><div class="av-lbl">${label}</div></div>`;
  const handleLine = f.username ? `<div class="av-email">@${esc(f.username)}</div>` : "";
  let h2hLine;
  if (!h2h.played) h2hLine = `<div class="fr-h2h">No matches played together yet.</div>`;
  else {
    const lead = h2h.wins > h2h.losses ? "You lead" : h2h.wins < h2h.losses ? "You trail" : "All square";
    const halves = h2h.halves ? ` · ${h2h.halves} halved` : "";
    h2hLine = `<div class="fr-h2h"><b>${lead}</b> ${h2h.wins}–${h2h.losses}${halves}` +
              ` <small>(${h2h.played} match${h2h.played === 1 ? "" : "es"})</small></div>`;
  }
  const totals = `<div class="av-grid">
    ${cell("Rounds", stats.rounds)}
    ${cell("Courses", stats.courses)}
    ${cell("Avg score", fmtSignedAvg(stats.avgToPar))}
    ${cell("Handicap", "<span class='av-hcp'>" + fmtSignedAvg(stats.handicap) + "</span><small> est.</small>")}
  </div>`;
  const best = stats.best
    ? `<div class="av-best">Best round: <b>${toparCell(stats.best.to_par)}</b> · ${stats.best.strokes} strokes · ${escapeHTML(courseName(stats.best.course_id))}</div>`
    : "";
  const recent = (stats._recent && stats._recent.length) ? `
    <div class="av-section">Recent rounds</div>
    <table class="lb-table av-table">
      <thead><tr><th>Date</th><th>Course</th><th>Score</th><th>Strk</th></tr></thead>
      <tbody>${stats._recent.map(r => `<tr><td class="av-date">${dateShort(r.created_at)}</td>
        <td>${escapeHTML(courseName(r.course_id))}</td>
        <td class="lb-topar">${toparCell(r.to_par)}</td>
        <td class="lb-strk">${r.strokes}</td></tr>`).join("")}</tbody></table>` : "";
  body.innerHTML = `<div class="av-id">${handleLine}</div>` + h2hLine +
    (stats.rounds ? (totals + best + recent) : `<div class="av-empty">No rounds played yet.</div>`);
}

(function wireFriends() {
  const menuBtn = document.getElementById("menu-friends");
  if (menuBtn) menuBtn.addEventListener("click", openFriends);
  const close = document.getElementById("fr-close");
  if (close) close.addEventListener("click", closeFriends);
  document.querySelectorAll("#friends-modal .fr-tab").forEach(t =>
    t.addEventListener("click", () => { _frTab = t.dataset.tab; renderFriends(); }));
  const body = document.getElementById("fr-body");
  if (body) body.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const fid = btn.dataset.fid, uid = btn.dataset.uid, inv = btn.dataset.inv, code = btn.dataset.code;
    if (btn.classList.contains("fr-accept")) { await acceptRequest(fid); renderFriends(); }
    else if (btn.classList.contains("fr-decline") || btn.classList.contains("fr-cancel")) { await removeFriendship(fid); renderFriends(); }
    else if (btn.classList.contains("fr-view")) { openFriendProfile(uid, fid); }
    else if (btn.classList.contains("fr-join")) { await acceptInvite(inv, code); }
    else if (btn.classList.contains("fr-decline-inv")) { await declineInvite(inv); renderFriends(); }
  });
  const back = document.getElementById("fp-back");
  if (back) back.addEventListener("click", closeFriendProfile);
  const unf = document.getElementById("fp-unfriend");
  if (unf) unf.addEventListener("click", async () => {
    if (_frProfileFid && confirm("Remove this friend?")) { await removeFriendship(_frProfileFid); closeFriendProfile(); renderFriends(); }
  });
  const inviteBtn = document.getElementById("fp-invite");
  if (inviteBtn) inviteBtn.addEventListener("click", () => inviteFriendToMatch(_frProfileUid));
})();

// ---- username prompt (shared by account viewer + first Friends open) ----
let _unCb = null;
function openUsernamePrompt(cb) {
  _unCb = cb || null;
  const ov = document.getElementById("username-modal");
  if (!ov) return;
  const inp = document.getElementById("un-input");
  const err = document.getElementById("un-error");
  if (err) err.classList.add("hidden");
  if (inp) inp.value = myUsername();
  ov.classList.remove("hidden");
  if (inp) setTimeout(() => inp.focus(), 30);
}
function closeUsernamePrompt() {
  const ov = document.getElementById("username-modal");
  if (ov) ov.classList.add("hidden");
}
(function wireUsername() {
  const cancel = document.getElementById("un-cancel");
  if (cancel) cancel.addEventListener("click", closeUsernamePrompt);
  const save = document.getElementById("un-save");
  const inp = document.getElementById("un-input");
  const err = document.getElementById("un-error");
  async function doSave() {
    const r = await saveUsername(inp ? inp.value : "");
    if (r.error) { if (err) { err.textContent = r.error; err.classList.remove("hidden"); } return; }
    closeUsernamePrompt();
    const cb = _unCb; _unCb = null;
    if (cb) cb();
  }
  if (save) save.addEventListener("click", doSave);
  if (inp) inp.addEventListener("keydown", e => { if (e.key === "Enter") doSave(); });
})();

// --- wiring ---
(function wireAddCourse() {
  const open = document.getElementById("menu-add-course");
  if (open) open.addEventListener("click", openAddCourse);
  const cancel = document.getElementById("ac-cancel");
  if (cancel) cancel.addEventListener("click", closeAddCourse);
  const inp = document.getElementById("ac-search");
  if (inp) inp.addEventListener("input", acOnInput);
})();
(function wireLeaderboard() {
  const ne = document.getElementById("name-entry");
  if (ne) {
    document.getElementById("ne-save").addEventListener("click", () => {
      const v = setPlayerName(document.getElementById("ne-input").value);
      const cb = _namePending; _namePending = null;  // capture BEFORE close (closeNameEntry nulls _namePending)
      closeNameEntry();
      if (v && cb) cb();
    });
    document.getElementById("ne-cancel").addEventListener("click", closeNameEntry);
    document.getElementById("ne-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("ne-save").click();
    });
  }
  const lb = document.getElementById("leaderboard");
  if (lb) {
    document.getElementById("lb-close").addEventListener("click", closeLeaderboard);
    const sel = document.getElementById("lb-course");
    if (sel) {
      sel.innerHTML = visibleCourses().map(c => `<option value="${c.id}">${c.name}</option>`).join("");
      sel.addEventListener("change", () => renderLeaderboard(sel.value));
    }
  }
  const ol = document.getElementById("open-leaderboard");
  if (ol) ol.addEventListener("click", () => openLeaderboard("menu"));
  const rl = document.getElementById("re-leaderboard");
  if (rl) rl.addEventListener("click", () => {
    document.getElementById("round-end").classList.add("hidden");
    openLeaderboard("round-end");
  });
  const pl = document.getElementById("menu-player");
  if (pl) pl.addEventListener("click", () => openNameEntry(null));
})();

// =====================================================================
//  Tournament Mode — async multi-player timed tournaments via Supabase.
//
//  Tables (run in Supabase SQL editor):
//
//  create table tournaments (
//    id            uuid primary key default gen_random_uuid(),
//    name          text not null,
//    course_id     text not null,
//    r1r2_opens    timestamptz not null,
//    r1r2_deadline timestamptz not null,
//    r3r4_opens    timestamptz,
//    r3r4_deadline timestamptz,
//    created_by    text
//  );
//  create table tournament_rounds (
//    id            uuid primary key default gen_random_uuid(),
//    tournament_id uuid references tournaments(id),
//    player_name   text not null,
//    round_num     int  not null check (round_num between 1 and 4),
//    strokes       int, to_par int, putts int, gir int, fir int,
//    fir_holes     int, prox_ft float,
//    submitted_at  timestamptz default now(),
//    unique (tournament_id, player_name, round_num)
//  );
//  Grant anon SELECT + INSERT on both tables.
//
//  ADMIN: tournament creation is gated by profiles.is_admin (see isTournamentAdmin
//  in the Accounts section). RLS enforces it server-side too.
// =====================================================================

// --- localStorage helpers ---
function getTournamentState() {
  try { return JSON.parse(localStorage.getItem("golf.tournament") || "null"); } catch(e) { return null; }
}
function setTournamentState(s) {
  try { localStorage.setItem("golf.tournament", s ? JSON.stringify(s) : "null"); } catch(e) {}
}

// --- Phase detection (pure, wall-clock based) ---
function tournamentPhase(t) {
  const now = Date.now();
  const d1 = new Date(t.r1r2_deadline).getTime();
  const d2 = t.r3r4_deadline ? new Date(t.r3r4_deadline).getTime() : null;
  if (now < d1)        return "r1r2";
  if (!d2 || now < d2) return "r3r4";
  return "complete";
}

// Group tournament_rounds rows by player (account when present, else name) and
// sum to_par across whatever rounds they've submitted. Sorted best-first. Shared
// by the per-round standings recap and the final results modal.
function standingsFromRows(rows) {
  const byPlayer = {};
  for (const r of rows) {
    const key = r.user_id ? ("u:" + r.user_id) : ("n:" + (r.player_name || "").toLowerCase());
    if (!byPlayer[key]) byPlayer[key] = { name: r.player_name, user_id: r.user_id || null, total: 0, count: 0 };
    byPlayer[key].total += r.to_par;
    byPlayer[key].count += 1;
  }
  return Object.values(byPlayer).sort((a, b) => a.total - b.total);
}

// --- Cut math ---
function computeCut(rows) {
  const byPlayer = {};
  for (const r of rows) {
    // key by account when present, else by name (legacy/guest rows)
    const key = r.user_id ? ("u:" + r.user_id) : ("n:" + (r.player_name || "").toLowerCase());
    if (!byPlayer[key]) byPlayer[key] = { name: r.player_name, user_id: r.user_id || null, rounds: {} };
    byPlayer[key].rounds[r.round_num] = r;
  }
  const combined = [];
  for (const d of Object.values(byPlayer)) {
    if (!d.rounds[1] || !d.rounds[2]) continue;
    combined.push({ name: d.name, user_id: d.user_id, totalToPar: d.rounds[1].to_par + d.rounds[2].to_par });
  }
  if (!combined.length) return { cutLine: null, survivors: [], combined: [] };
  combined.sort((a, b) => a.totalToPar - b.totalToPar);
  const cutPos = Math.ceil(combined.length / 2); // ceil → odd middle survives
  const cutLine = combined[cutPos - 1].totalToPar;
  return { cutLine, survivors: combined.filter(p => p.totalToPar <= cutLine), combined };
}

// Identity key for a standings entry (account when present, else name).
function entryKey(e) {
  return e.user_id ? ("u:" + e.user_id) : ("n:" + (e.name || e.player_name || "").toLowerCase());
}
// Is this standings entry the current player?
function isMeEntry(e) {
  const u = currentUser();
  if (u && e.user_id) return e.user_id === u.id;
  const myName = (getPlayerName() || "").toLowerCase();
  return !!myName && (e.name || e.player_name || "").toLowerCase() === myName;
}

// 1, 2, 3 → "1st", "2nd", "3rd" (English ordinals).
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
// Rank standings by lowest total score (stroke play), sharing a position on
// ties (standard competition ranking: 1,2,2,4). Each row gets {pos, tied}.
// Sorts here so callers don't have to: the DB feed is already score-sorted, but
// the local CPU-match feed (cpuMatchRows) is in insertion order — without this
// sort the local player always landed at index 0 and was ranked the winner
// regardless of score. On equal scores, more holes played ranks ahead.
function rankMatchRows(rows) {
  rows = [...rows].sort((a, b) =>
    ((a.score || 0) - (b.score || 0)) || ((b.holes_played || 0) - (a.holes_played || 0)));
  const out = rows.map((r, i) => ({
    ...r,
    pos: (i > 0 && rows[i - 1].score === r.score) ? null : i + 1,
  }));
  for (let i = 0; i < out.length; i++) if (out[i].pos === null) out[i].pos = out[i - 1].pos;
  const counts = {};
  out.forEach(r => counts[r.pos] = (counts[r.pos] || 0) + 1);
  out.forEach(r => r.tied = counts[r.pos] > 1);
  return out;
}
// "1st" / "T-2nd" position label for a ranked row.
function posLabel(r) { return (r.tied ? "T-" : "") + ordinal(r.pos); }

// --- Supabase helpers ---
async function fetchActiveTournament(courseId) {
  if (!LB_ON()) return null;
  try {
    const q = "/rest/v1/tournaments?course_id=eq." + encodeURIComponent(courseId) +
              "&order=r1r2_opens.desc&limit=1";
    const res = await fetch(LB_URL + q, { headers: lbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch(e) { return null; }
}

async function submitTournamentRound(payload) {
  if (!LB_ON() || !payload.player_name) return false;
  try {
    const res = await fetch(LB_URL + "/rest/v1/tournament_rounds", {
      method: "POST",
      headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch(e) { console.warn("Tournament round submit failed:", e); return false; }
}

async function fetchTournamentRounds(tournamentId) {
  if (!LB_ON()) return [];
  try {
    const q = "/rest/v1/tournament_rounds?tournament_id=eq." + encodeURIComponent(tournamentId) +
              "&order=round_num.asc,submitted_at.asc";
    const res = await fetch(LB_URL + q, { headers: lbHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch(e) { return []; }
}

const PHASE_MS = 60 * 60 * 1000;   // default duration of each tournament phase (R1/R2, then R3/R4)

// Round-window timestamps from an open time + per-phase durations (ms). R3/R4
// opens when R1/R2 closes. Setting r3r4_deadline is what lets a tournament
// reach "complete". Shared by create + admin time-limit edits so they agree.
function computeWindows(openMs, r1r2Len, r3r4Len) {
  const r1r2Deadline = openMs + (r1r2Len || PHASE_MS);
  const r3r4Deadline = r1r2Deadline + (r3r4Len || PHASE_MS);
  return {
    r1r2_opens: new Date(openMs).toISOString(),
    r1r2_deadline: new Date(r1r2Deadline).toISOString(),
    r3r4_opens: new Date(r1r2Deadline).toISOString(),
    r3r4_deadline: new Date(r3r4Deadline).toISOString(),
  };
}

async function createTournament(name, courseId, settings) {
  if (!LB_ON()) return null;
  const payload = Object.assign(
    computeWindows(Date.now(), PHASE_MS, PHASE_MS),
    {
      name, course_id: courseId,
      created_by: getPlayerName() || "Anonymous",
      settings: settings ? normalizeSettings(settings) : normalizeSettings(gameDefaults),
    }
  );
  try {
    const res = await fetch(LB_URL + "/rest/v1/tournaments", {
      method: "POST",
      headers: authHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch(e) { return null; }
}

// --- Admin management REST helpers (gated by isTournamentAdmin + RLS) ---
async function fetchAllTournaments() {
  if (!LB_ON()) return [];
  try {
    const res = await fetch(LB_URL + "/rest/v1/tournaments?select=*&order=created_at.desc&limit=50",
      { headers: lbHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch(e) { return []; }
}
async function updateTournament(id, patch) {
  if (!LB_ON() || !isTournamentAdmin()) return false;
  try {
    const res = await fetch(LB_URL + "/rest/v1/tournaments?id=eq." + encodeURIComponent(id), {
      method: "PATCH", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch(e) { console.warn("Update tournament failed:", e); return false; }
}
async function deleteTournament(id) {
  if (!LB_ON() || !isTournamentAdmin()) return false;
  try {
    const res = await fetch(LB_URL + "/rest/v1/tournaments?id=eq." + encodeURIComponent(id), {
      method: "DELETE", headers: authHeaders({ Prefer: "return=minimal" }),
    });
    return res.ok;   // tournament_rounds cascade-delete via FK
  } catch(e) { console.warn("Delete tournament failed:", e); return false; }
}
// Remove (DQ) a player: delete all their rounds in this tournament. Match by
// account when present, else by name (mirrors entryKey identity).
async function removeTournamentPlayer(tid, entry) {
  if (!LB_ON() || !isTournamentAdmin()) return false;
  let q = "/rest/v1/tournament_rounds?tournament_id=eq." + encodeURIComponent(tid) + "&";
  q += entry.user_id
    ? "user_id=eq." + encodeURIComponent(entry.user_id)
    : "player_name=eq." + encodeURIComponent(entry.name || entry.player_name || "");
  try {
    const res = await fetch(LB_URL + q, { method: "DELETE", headers: authHeaders({ Prefer: "return=minimal" }) });
    return res.ok;
  } catch(e) { console.warn("Remove player failed:", e); return false; }
}
// Force-complete: push both deadlines into the past so tournamentPhase -> "complete".
async function endTournamentNow(t) {
  const past = new Date(Date.now() - 1000).toISOString();
  return updateTournament(t.id, { r1r2_deadline: past, r3r4_deadline: past });
}

// --- Global game settings (singleton row id=1; admin writes, everyone reads) ---
async function fetchGameSettings() {
  if (!LB_ON()) return null;
  try {
    const res = await fetch(LB_URL + "/rest/v1/game_settings?id=eq.1&select=settings", { headers: lbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return (rows[0] && rows[0].settings) || null;
  } catch(e) { return null; }
}
async function saveGameSettings(s) {
  if (!LB_ON() || !isTournamentAdmin()) return false;
  try {
    const res = await fetch(LB_URL + "/rest/v1/game_settings?id=eq.1", {
      method: "PATCH", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ settings: normalizeSettings(s), updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch(e) { console.warn("Save settings failed:", e); return false; }
}

// --- HUD countdown timer (shown during active tournament round) ---
let _trnTimerInterval = null;

function startTournamentTimer(deadline, elId) {
  stopTournamentTimer();
  const el = document.getElementById(elId || "trn-timer");
  if (!el) return;
  el.classList.remove("hidden");
  const deadlineMs = new Date(deadline).getTime();
  function tick() {
    const rem = deadlineMs - Date.now();
    if (rem <= 0) {
      el.textContent = "Time's up";
      el.classList.add("trn-timer-urgent");
      clearInterval(_trnTimerInterval); _trnTimerInterval = null;
      return;
    }
    const m = Math.floor(rem / 60000);
    const s = Math.floor((rem % 60000) / 1000);
    el.textContent = m + ":" + s.toString().padStart(2, "0");
    el.classList.toggle("trn-timer-urgent", rem < 10 * 60 * 1000);
  }
  tick();
  _trnTimerInterval = setInterval(tick, 1000);
}

function stopTournamentTimer() {
  if (_trnTimerInterval) { clearInterval(_trnTimerInterval); _trnTimerInterval = null; }
  const el = document.getElementById("trn-timer");
  if (el) { el.classList.add("hidden"); el.classList.remove("trn-timer-urgent"); el.textContent = ""; }
}

// --- Hook into round completion ---
function handleTournamentRoundComplete() {
  const roundNum = activeTournamentRound;
  if (roundNum === null || !activeTournament) return;
  activeTournamentRound = null;
  stopTournamentTimer();

  const go = async () => {
    const base = buildRoundPayload();
    if (!base) return;
    const payload = {
      tournament_id: activeTournament.id,
      player_name: getPlayerName(),
      user_id: (currentUser() || {}).id || null,
      round_num: roundNum,
      strokes: base.strokes, to_par: base.to_par, putts: base.putts,
      gir: base.gir, fir: base.fir, fir_holes: base.fir_holes, prox_ft: base.prox_ft,
    };
    const ok = await submitTournamentRound(payload);
    if (ok) {
      const s = getTournamentState() || { id: activeTournament.id, roundsSubmitted: [] };
      s.id = activeTournament.id;
      if (!s.roundsSubmitted.includes(roundNum)) s.roundsSubmitted.push(roundNum);
      setTournamentState(s);
    }

    const row = document.getElementById("re-tournament-row");
    const btn = document.getElementById("re-tournament");
    if (row && btn) {
      if (roundNum === 2) {
        btn.innerHTML = '<span class="ic ic-scissors"></span>View Cut Results';
        row.classList.remove("hidden");
        btn.onclick = () => {
          document.getElementById("round-end").classList.add("hidden");
          showCutModal();
        };
      } else if (roundNum === 4) {
        btn.innerHTML = '<span class="ic ic-trophy"></span>Final Results';
        row.classList.remove("hidden");
        btn.onclick = () => {
          document.getElementById("round-end").classList.add("hidden");
          showTournamentFinal();
        };
      } else {
        // R1 / R3: show where the player stands in the field.
        btn.innerHTML = '<span class="ic ic-flag-checkered"></span>Tournament Standings';
        row.classList.remove("hidden");
        btn.onclick = () => {
          document.getElementById("round-end").classList.add("hidden");
          showStandings(roundNum);
        };
      }
    }
  };

  if (!LB_ON()) return;
  if (!getPlayerName()) openNameEntry(go);
  else go();
}

// --- Cut results modal ---
async function showCutModal() {
  if (!activeTournament) return;
  const rows = await fetchTournamentRounds(activeTournament.id);
  const { cutLine, survivors, combined } = computeCut(rows);

  const empty = document.getElementById("tc-empty");
  if (!combined.length) {
    if (empty) { empty.textContent = "No complete R1+R2 entries yet."; empty.classList.remove("hidden"); }
    document.getElementById("tournament-cut").classList.remove("hidden");
    document.getElementById("tc-field-count").textContent = "";
    document.getElementById("tc-status").textContent = "";
    document.getElementById("tc-status").className = "tc-status";
    document.getElementById("tc-list").innerHTML = "";
    document.getElementById("tc-continue").textContent = "Back to Menu";
    document.getElementById("tc-continue").onclick = closeTournamentCutToMenu;
    return;
  }
  if (empty) empty.classList.add("hidden");

  const survivorKeys = new Set(survivors.map(entryKey));
  const myEntry = combined.find(isMeEntry);
  const madeCut = !!myEntry && survivorKeys.has(entryKey(myEntry));

  document.getElementById("tc-field-count").textContent =
    combined.length + " player" + (combined.length !== 1 ? "s" : "") +
    " · cut " + (cutLine !== null ? formatToPar(cutLine) : "—") +
    " · " + survivors.length + " advance";

  const statusEl = document.getElementById("tc-status");
  if (!myEntry) {
    statusEl.textContent = "Your score not found — did you submit R1 & R2?";
    statusEl.className = "tc-status";
  } else if (madeCut) {
    statusEl.textContent = "You made the cut! (" + formatToPar(myEntry.totalToPar) + ")";
    statusEl.className = "tc-status tc-made";
  } else {
    statusEl.textContent = "Missed the cut (" + formatToPar(myEntry.totalToPar) + ")";
    statusEl.className = "tc-status tc-missed";
  }

  const list = document.getElementById("tc-list");
  list.innerHTML = combined.map((p, i) => {
    const survived = survivorKeys.has(entryKey(p));
    const isMe = isMeEntry(p);
    const rowCls = (survived ? "tc-row-made" : "tc-row-missed") + (isMe ? " tc-me" : "");
    return "<tr class=\"" + rowCls + "\">" +
      "<td class=\"lb-rank\">" + (i + 1) + "</td>" +
      "<td class=\"lb-name\">" + escapeHTML(p.name) + "</td>" +
      "<td class=\"lb-topar\">" + formatToPar(p.totalToPar) + "</td>" +
      "<td class=\"tc-badge\">" + (survived ? "✓" : "✗") + "</td></tr>";
  }).join("");

  const cont = document.getElementById("tc-continue");
  if (madeCut) {
    cont.textContent = "Play Round 3";
    cont.onclick = () => {
      document.getElementById("tournament-cut").classList.add("hidden");
      startTournamentRound(3);
    };
  } else {
    cont.textContent = "Back to Menu";
    cont.onclick = closeTournamentCutToMenu;
  }

  document.getElementById("tournament-cut").classList.remove("hidden");
}

function closeTournamentCutToMenu() {
  document.getElementById("tournament-cut").classList.add("hidden");
  mode = "menu";
  elMenu.classList.remove("hidden");
  elHudBtn.classList.add("hidden");
  elHmClubRow.classList.add("hidden");
  closeHud();
  elScorecard.style.display = "none";
}

// --- Tournament final results modal ---
async function showTournamentFinal() {
  if (!activeTournament) return;
  const rows = await fetchTournamentRounds(activeTournament.id);

  const standings = standingsFromRows(rows)
    .filter(p => p.count >= 3);  // R3/R4 players (survivors)

  document.getElementById("tf-title").textContent = activeTournament.name + " — Final";
  const tfEmpty = document.getElementById("tf-empty");
  const list = document.getElementById("tf-list");

  if (!standings.length) {
    list.innerHTML = "";
    if (tfEmpty) { tfEmpty.textContent = "No finishers yet."; tfEmpty.classList.remove("hidden"); }
  } else {
    if (tfEmpty) tfEmpty.classList.add("hidden");
    list.innerHTML = standings.map((p, i) => {
      const isMe = isMeEntry(p);
      const rank = i < 3 ? `<b class="tf-medal">${ordinal(i + 1)}</b>` : ordinal(i + 1);
      return "<tr" + (isMe ? " class=\"tc-me\"" : "") + ">" +
        "<td class=\"lb-rank\">" + rank + "</td>" +
        "<td class=\"lb-name\">" + escapeHTML(p.name) + "</td>" +
        "<td class=\"lb-topar\">" + formatToPar(p.total) + "</td></tr>";
    }).join("");
  }

  document.getElementById("tournament-final").classList.remove("hidden");
}

// --- Per-round field standings recap (shown after R1 and R3; R2 uses the cut
//     modal, R4 the final). Whole field ranked by cumulative to-par, me highlighted. ---
async function showStandings(afterRound) {
  if (!activeTournament) return;
  const rows = await fetchTournamentRounds(activeTournament.id);
  const standings = standingsFromRows(rows);

  document.getElementById("ts-title").textContent =
    activeTournament.name + " — Through Round " + afterRound;

  const tsEmpty = document.getElementById("ts-empty");
  const statusEl = document.getElementById("ts-status");
  const list = document.getElementById("ts-list");

  if (!standings.length) {
    list.innerHTML = "";
    statusEl.textContent = "";
    if (tsEmpty) { tsEmpty.textContent = "No scores in yet."; tsEmpty.classList.remove("hidden"); }
    document.getElementById("tournament-standings").classList.remove("hidden");
    return;
  }
  if (tsEmpty) tsEmpty.classList.add("hidden");

  const myIdx = standings.findIndex(isMeEntry);
  statusEl.textContent = myIdx >= 0
    ? "You're " + formatToPar(standings[myIdx].total) +
      " · Pos " + (myIdx + 1) + " of " + standings.length
    : "Your score isn't in the field yet.";

  list.innerHTML = standings.map((p, i) => {
    const isMe = isMeEntry(p);
    return "<tr" + (isMe ? " class=\"tc-me\"" : "") + ">" +
      "<td class=\"lb-rank\">" + (i + 1) + "</td>" +
      "<td class=\"lb-name\">" + escapeHTML(p.name) + "</td>" +
      "<td class=\"lb-topar\">" + formatToPar(p.total) + "</td>" +
      "<td class=\"tc-badge\">" + p.count + "</td></tr>";
  }).join("");

  document.getElementById("tournament-standings").classList.remove("hidden");
}

function closeStandingsToMenu() {
  document.getElementById("tournament-standings").classList.add("hidden");
  mode = "menu";
  elMenu.classList.remove("hidden");
  elHudBtn.classList.add("hidden");
  elHmClubRow.classList.add("hidden");
  closeHud();
  elScorecard.style.display = "none";
}

// --- Lobby ---
let _lobbyTimer = null;

function startLobbyTimer(deadline) {
  stopLobbyTimer();
  const el = document.getElementById("tl-timer");
  if (!el) return;
  const deadlineMs = new Date(deadline).getTime();
  function tick() {
    const rem = deadlineMs - Date.now();
    if (rem <= 0) { el.textContent = "Time's up"; stopLobbyTimer(); return; }
    const h = Math.floor(rem / 3600000);
    const m = Math.floor((rem % 3600000) / 60000);
    const s = Math.floor((rem % 60000) / 1000);
    el.textContent = h > 0
      ? h + ":" + m.toString().padStart(2, "0") + ":" + s.toString().padStart(2, "0") + " remaining"
      : m + ":" + s.toString().padStart(2, "0") + " remaining";
  }
  tick();
  _lobbyTimer = setInterval(tick, 1000);
}

function stopLobbyTimer() {
  if (_lobbyTimer) { clearInterval(_lobbyTimer); _lobbyTimer = null; }
}

async function openTournamentLobby() {
  const modal = document.getElementById("tournament-lobby");
  modal.classList.remove("hidden");
  document.getElementById("tl-name").textContent = "Loading…";
  document.getElementById("tl-status").textContent = "";
  document.getElementById("tl-timer").textContent = "";
  document.getElementById("tl-field").textContent = "";
  document.getElementById("tl-rounds").innerHTML = "";
  document.getElementById("tl-start").classList.add("hidden");
  stopLobbyTimer();

  if (!LB_ON()) {
    document.getElementById("tl-name").textContent = "Leaderboard not configured";
    document.getElementById("tl-status").textContent = "Set LB_URL and LB_KEY in game.js";
    return;
  }

  const t = await fetchActiveTournament(selectedCourseId);
  activeTournament = t || null;

  if (!t) {
    document.getElementById("tl-name").textContent = "No active tournament";
    document.getElementById("tl-status").textContent =
      "for " + ((COURSES.find(c => c.id === selectedCourseId) || {}).name || selectedCourseId);
    if (isTournamentAdmin()) {
      document.getElementById("tl-start").classList.remove("hidden");
    } else {
      document.getElementById("tl-field").textContent = "Check back when one is scheduled.";
    }
    return;
  }

  document.getElementById("tl-name").textContent = t.name;
  const phase = tournamentPhase(t);
  const trnState = getTournamentState();
  const submitted = (trnState && trnState.id === t.id) ? trnState.roundsSubmitted : [];

  const allRows = await fetchTournamentRounds(t.id);
  const players = new Set(allRows.map(r => entryKey(r)));
  document.getElementById("tl-field").textContent =
    players.size + " player" + (players.size !== 1 ? "s" : "") + " entered";

  // Tournaments require an account (scores must tie to a real user).
  if (!isLoggedIn()) {
    document.getElementById("tl-status").textContent =
      phase === "r1r2" ? "Rounds 1 & 2 open" : phase === "r3r4" ? "Rounds 3 & 4 open" : "Complete";
    document.getElementById("tl-rounds").innerHTML =
      "<p class=\"tl-missed\">Sign in to compete.</p>" +
      "<button class=\"menu-btn\" id=\"tl-signin\">Sign in</button>";
    document.getElementById("tl-signin").onclick = () => { closeTournamentLobby(); openAuthModal(); };
    return;
  }

  if (phase === "r1r2") {
    document.getElementById("tl-status").textContent = "Rounds 1 & 2 open";
    startLobbyTimer(t.r1r2_deadline);

    const r1done = submitted.includes(1);
    const r2done = submitted.includes(2);
    const rounds = document.getElementById("tl-rounds");
    rounds.innerHTML =
      "<button class=\"menu-btn" + (r1done ? " secondary" : "") + "\" id=\"tl-play-r1\">" +
        (r1done ? "✓ Round 1 complete" : "Play Round 1") + "</button>" +
      "<button class=\"menu-btn" + (r1done && !r2done ? "" : " secondary") + "\" id=\"tl-play-r2\"" +
        (r2done || r1done ? "" : " disabled") + ">" +
        (r2done ? "✓ Round 2 complete" : "Play Round 2") + "</button>";

    if (!r1done) {
      document.getElementById("tl-play-r1").onclick = () => {
        closeTournamentLobby(); startTournamentRound(1);
      };
    }
    if (r1done && !r2done) {
      document.getElementById("tl-play-r2").onclick = () => {
        closeTournamentLobby(); startTournamentRound(2);
      };
    }

  } else if (phase === "r3r4") {
    document.getElementById("tl-status").textContent = "Cut complete — Rounds 3 & 4 open";
    if (t.r3r4_deadline) startLobbyTimer(t.r3r4_deadline);

    const { survivors } = computeCut(allRows);
    const madeCut = survivors.some(isMeEntry);
    const r3done = submitted.includes(3);
    const r4done = submitted.includes(4);
    const rounds = document.getElementById("tl-rounds");

    if (madeCut) {
      rounds.innerHTML =
        "<button class=\"menu-btn" + (r3done ? " secondary" : "") + "\" id=\"tl-play-r3\">" +
          (r3done ? "✓ Round 3 complete" : "Play Round 3") + "</button>" +
        "<button class=\"menu-btn" + (r3done && !r4done ? "" : " secondary") + "\" id=\"tl-play-r4\"" +
          (r4done || r3done ? "" : " disabled") + ">" +
          (r4done ? "✓ Round 4 complete" : "Play Round 4") + "</button>";
      if (!r3done) document.getElementById("tl-play-r3").onclick = () => { closeTournamentLobby(); startTournamentRound(3); };
      if (r3done && !r4done) document.getElementById("tl-play-r4").onclick = () => { closeTournamentLobby(); startTournamentRound(4); };
    } else {
      rounds.innerHTML = "<p class=\"tl-missed\">You missed the cut.</p>" +
        "<button class=\"menu-btn secondary\" id=\"tl-view-cut\">View Cut Results</button>";
      document.getElementById("tl-view-cut").onclick = () => { closeTournamentLobby(); showCutModal(); };
    }

  } else {
    document.getElementById("tl-status").textContent = "Tournament complete";
    document.getElementById("tl-rounds").innerHTML =
      "<button class=\"menu-btn secondary\" id=\"tl-view-final\">View Final Results</button>";
    document.getElementById("tl-view-final").onclick = () => { closeTournamentLobby(); showTournamentFinal(); };
  }

  // Admins can always begin the next tournament (a new one supersedes this via
  // fetchActiveTournament's newest-first ordering), regardless of the current phase.
  if (isTournamentAdmin()) {
    const sb = document.getElementById("tl-start");
    sb.textContent = "+ Start new tournament";
    sb.classList.remove("hidden");
  }
}

function closeTournamentLobby() {
  stopLobbyTimer();
  document.getElementById("tournament-lobby").classList.add("hidden");
}

function startTournamentRound(roundNum) {
  if (!activeTournament) return;
  if (!isLoggedIn()) { openAuthModal(); return; }   // account required to compete
  activeTournamentRound = roundNum;
  const deadline = roundNum <= 2 ? activeTournament.r1r2_deadline : activeTournament.r3r4_deadline;
  if (deadline) startTournamentTimer(deadline, "trn-timer");
  startCourse();
}

// ---------------------------------------------------------------------
//  Live PGA Tour — "This Week on Tour"
//  Pulls the real PGA Tour schedule + live status from ESPN's public,
//  keyless, CORS-open endpoints, matches the event's venue to a baked
//  course, and routes players in via the existing tournament infra.
//   - scoreboard: which event(s) are live/upcoming right now
//   - core event: the venue (course name, city, par, per-hole yardage)
//  Both send Access-Control-Allow-Origin: * so the static client can
//  fetch directly — no proxy. ESPN's core endpoint 502s transiently, so
//  every fetch retries. On total failure the panel degrades gracefully.
// ---------------------------------------------------------------------
const TOUR_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";
const TOUR_CORE_EVENT = "https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/";
const TOUR_CACHE_MS = 5 * 60 * 1000;   // throttle ESPN hits within a session
let _tourCache = null;                 // { at, data }

async function fetchJSONRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch (e) { /* transient — retry */ }
  }
  return null;
}

// Featured event = a live one if any, else the soonest upcoming, else the
// most recent. Null only on total feed failure (offline / ESPN down).
async function fetchTourNow() {
  if (_tourCache && Date.now() - _tourCache.at < TOUR_CACHE_MS) return _tourCache.data;
  const sb = await fetchJSONRetry(TOUR_SCOREBOARD);
  if (!sb) return null;
  const evs = (sb.events || []).map((e) => ({
    id: e.id,
    name: e.name || e.shortName,
    state: (((e.status || {}).type) || {}).state || "pre",   // pre | in | post
    start: e.date || e.startDate,
  }));
  const live = evs.find((e) => e.state === "in");
  const pre  = evs.filter((e) => e.state === "pre").sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  const post = evs.filter((e) => e.state === "post").sort((a, b) => new Date(b.start) - new Date(a.start))[0];
  const data = { featured: live || pre || post || evs[0] || null, all: evs };
  _tourCache = { at: Date.now(), data };
  return data;
}

// Venue detail for an event (course name, location, par, per-hole data).
async function fetchTourCourse(eventId) {
  const d = await fetchJSONRetry(TOUR_CORE_EVENT + encodeURIComponent(eventId));
  if (!d) return null;
  const c = (d.courses || [])[0];
  if (!c) return null;
  const a = c.address || {};
  return {
    name: c.name,
    city: a.city, region: a.state || a.region, country: a.country,
    par: c.shotsToPar, yards: c.totalYards,
    holes: (c.holes || []).map((h) => ({ num: h.number, par: h.shotsToPar, yards: h.totalYards })),
  };
}

// Generic tokens dropped before matching ESPN venue names to our manifest.
const _COURSE_STOP = new Set(["the","golf","club","course","country","links",
  "resort","gc","cc","no","and","at","complex","courses"]);
function _normCourse(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter((w) => w && !_COURSE_STOP.has(w));
}
// Match an ESPN venue name to a baked course by significant-token overlap.
// Returns the COURSES entry or null. Threshold 0.6 of the ESPN name's tokens.
function matchTourCourse(name) {
  const want = _normCourse(name);
  if (!want.length) return null;
  let best = null, bestScore = 0;
  for (const c of COURSES) {
    if (HIDDEN_COURSE_IDS.has(c.id)) continue;
    const have = new Set(_normCourse(c.name));
    let overlap = 0;
    for (const w of want) if (have.has(w)) overlap++;
    const score = overlap / want.length;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.6 ? best : null;
}

function fmtEventDate(iso) {
  if (!iso) return "soon";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch (e) { return "soon"; }
}

async function openTourWeek() {
  const modal = document.getElementById("tour-week");
  modal.classList.remove("hidden");
  const $ = (id) => document.getElementById(id);
  $("tw-event").textContent = "Loading…";
  $("tw-status").textContent = "";
  $("tw-course").textContent = "";
  $("tw-note").textContent = "";
  $("tw-actions").innerHTML = "";
  tourEventName = null;

  const now = await fetchTourNow();
  if (modal.classList.contains("hidden")) return;   // user closed while awaiting
  if (!now || !now.featured) {
    $("tw-event").textContent = "Schedule unavailable";
    $("tw-status").textContent = "Couldn't reach the tour feed — try again later.";
    return;
  }
  const ev = now.featured;
  $("tw-event").textContent = ev.name;
  $("tw-status").textContent =
    ev.state === "in"  ? "● Live now" :
    ev.state === "pre" ? "Starts " + fmtEventDate(ev.start) :
                         "Final · " + fmtEventDate(ev.start);

  const course = await fetchTourCourse(ev.id);
  if (modal.classList.contains("hidden")) return;
  if (!course) { $("tw-course").textContent = "Venue to be announced"; return; }
  const loc = [course.city, course.region || course.country].filter(Boolean).join(", ");
  $("tw-course").textContent = course.name +
    (loc ? " · " + loc : "") + (course.par ? " · Par " + course.par : "");

  const matched = matchTourCourse(course.name);
  if (!matched) {
    $("tw-note").textContent = "Not in the game yet — check back after it's added.";
    return;
  }

  // Baked course in hand — route via the tournament infra (chosen play model).
  selectedCourseId = matched.id;
  tourEventName = ev.name;
  _tourCourseId = matched.id;   // free taste — this week's venue unlocks (isTourFeatured)
  const actions = $("tw-actions");
  const active = LB_ON() ? await fetchActiveTournament(matched.id) : null;
  if (modal.classList.contains("hidden")) return;

  if (active) {
    activeTournament = active;
    actions.innerHTML = "<button class=\"menu-btn\" id=\"tw-enter\">Enter tournament</button>";
    $("tw-enter").onclick = () => { closeTourWeek(); openTournamentLobby(); };
  } else if (isTournamentAdmin() && LB_ON()) {
    // Only admins can create (RLS-gated); non-admins fall through to solo below.
    actions.innerHTML =
      "<button class=\"menu-btn\" id=\"tw-create\">Start tour tournament</button>" +
      "<button class=\"menu-btn secondary\" id=\"tw-solo\">Play the course solo</button>";
    $("tw-create").onclick = async () => {
      const b = $("tw-create"); b.disabled = true; b.textContent = "Creating…";
      const t = await createTournament(ev.name, matched.id, gameDefaults);
      if (t) { activeTournament = t; closeTourWeek(); openTournamentLobby(); }
      else { b.disabled = false; b.textContent = "Start tour tournament"; showToast("Couldn't create tournament", 2000); }
    };
    $("tw-solo").onclick = () => { closeTourWeek(); startCourse(); };
  } else {
    $("tw-note").textContent = "This week's course is in the game.";
    actions.innerHTML = "<button class=\"menu-btn\" id=\"tw-solo\">Play this course</button>";
    $("tw-solo").onclick = () => { closeTourWeek(); startCourse(); };
  }
}

function closeTourWeek() { document.getElementById("tour-week").classList.add("hidden"); }

// =====================================================================
//  Tour Events — live Masters-style leaderboard + compete against the pros
//  A spectator layer (NOT a Supabase tournament): pull the current/most-recent
//  real PGA event's whole field live from ESPN, let the player's own local score
//  (from playing the event's course) merge into the field, and keep a TV-style
//  scorebug pinned bottom-left during gameplay. My scores persist locally in
//  golf.tourEvent; the pros' come live from TOUR_SCOREBOARD.
// =====================================================================
let _tourBoardData = null;        // last-fetched leaderboard {eventId,name,state,round,roundLabel,courseName,players}
let _tourCourseMatch = null;      // baked COURSES entry for the event venue, or null

function _parseToPar(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = ("" + v).trim();
  if (s === "E" || s === "e") return 0;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}
function _parClass(n) { return n == null ? "" : n < 0 ? "tp-under" : n > 0 ? "tp-over" : "tp-even"; }
function _parText(n) { return n == null ? "—" : formatToPar(n); }

// Featured event pick (mirrors fetchTourNow) but over the raw scoreboard so we
// keep each event's full competitors array. Short 45s cache for live freshness.
async function fetchTourLeaderboard() {
  if (_tourLbCache && Date.now() - _tourLbCache.at < 45000) return _tourLbCache.data;
  const sb = await fetchJSONRetry(TOUR_SCOREBOARD);
  if (!sb || !(sb.events || []).length) return null;
  const st = (e) => (((e.status || {}).type) || {}).state || "pre";
  const evs = sb.events;
  const ev = evs.find((e) => st(e) === "in")
    || evs.filter((e) => st(e) === "pre").sort((a, b) => new Date(a.date) - new Date(b.date))[0]
    || evs.filter((e) => st(e) === "post").sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    || evs[0];
  const state = st(ev);
  const comp = (ev.competitions || [])[0] || {};
  const round = ((ev.status || {}).period) || (comp.status || {}).period || 1;
  const roundLabel = state === "post" ? "Final"
    : state === "pre" ? "Starts soon"
    : "Round " + round + " · In Progress";

  const players = (comp.competitors || []).map((c) => {
    const a = c.athlete || {};
    const ls = c.linescores || [];
    const cs = c.status || {};
    const total = _parseToPar(c.score);
    const completed = !!((cs.type || {}).completed) || state === "post";
    const thru = cs.thru != null ? cs.thru : (completed ? "F" : (ls.length ? "F" : "—"));
    const today = ls.length ? _parseToPar(ls[ls.length - 1].displayValue) : null;
    return {
      name: a.displayName || a.shortName || "—",
      flag: (a.flag || {}).href || null,
      total,
      rounds: ls.map((l) => ({ n: l.period, strokes: l.value, toPar: _parseToPar(l.displayValue) })),
      today, thru, pos: c.order,
    };
  }).filter((p) => p.total != null || p.rounds.length);
  players.sort((a, b) => (a.total == null ? 999 : a.total) - (b.total == null ? 999 : b.total));

  const data = { eventId: ev.id, name: ev.name || ev.shortName, state, round, roundLabel, courseName: null, players };
  _tourLbCache = { at: Date.now(), data };
  return data;
}

// --- My local standing (persisted, merges into the real field) ---
function getTourEvent() { return lsGet("golf.tourEvent", null); }
function setTourEvent(o) { lsSet("golf.tourEvent", o); }
function ensureTourEvent(eventId, name) {
  let te = getTourEvent();
  if (!te || te.eventId !== eventId) { te = { eventId, name, rounds: [] }; setTourEvent(te); }
  return te;
}
// My row for the merged board: cumulative to-par across completed rounds + the
// live round in progress. Self-paced — my THRU shows my own progress.
function tourMyStanding() {
  const te = getTourEvent();
  if (!te) return null;
  const inRound = tourPlayMode;
  // Don't appear on the board until there's a score to show (a completed round
  // or a live one) — an empty "E" row before teeing off reads as a bug.
  if (!(te.rounds || []).length && !inRound) return null;
  const done = (te.rounds || []).reduce((s, x) => s + x, 0);
  const total = done + (inRound ? (round.score || 0) : 0);
  const roundsPlayed = (te.rounds || []).length + (inRound ? 1 : 0);
  const thru = inRound ? (round.holesPlayed || 0) : (roundsPlayed ? "F" : "—");
  const today = inRound ? (round.score || 0)
    : ((te.rounds || []).length ? te.rounds[te.rounds.length - 1] : null);
  return {
    name: getPlayerName() || "You", flag: null, total,
    rounds: (te.rounds || []).map((tp, i) => ({ n: i + 1, toPar: tp })),
    today, thru, isMe: true, roundN: roundsPlayed,
  };
}
// Which round the board should reflect = the round the PLAYER is on. Pros are
// shown aggregated THROUGH this round (R1 → R1 only, R2 → 1+2, …), so the field
// always compares like-for-like against my progress. 1..4.
function tourDisplayRound() {
  const te = getTourEvent();
  const banked = te && te.rounds ? te.rounds.length : 0;
  const inRound = tourPlayMode;
  let n = banked + (inRound ? 1 : 0);
  return Math.min(Math.max(n, 1), 4);
}
// Re-aggregate each pro's total/today to only their rounds 1..N, then re-sort.
function projectField(players, n) {
  return players.map((p) => {
    let total = 0, cnt = 0, today = null;
    for (const r of (p.rounds || [])) {
      if (r.n <= n && r.toPar != null) { total += r.toPar; cnt++; if (r.n === n) today = r.toPar; }
    }
    return Object.assign({}, p, {
      total: cnt ? total : null,
      today,
      thru: (today != null) ? p.thru : (cnt ? "—" : p.thru),  // didn't reach round n
    });
  }).sort((a, b) => (a.total == null ? 999 : a.total) - (b.total == null ? 999 : b.total));
}

function mergeMeIntoField(players, eventId) {
  const te = getTourEvent();
  const me = tourMyStanding();
  if (!me || !te || te.eventId !== eventId) return players.slice();
  const out = players.slice();
  out.push(me);
  out.sort((a, b) => (a.total == null ? 999 : a.total) - (b.total == null ? 999 : b.total));
  return out;
}
// Called at round end (real finish only): bank this round's to-par into the
// followed event, cap 4 rounds. Consumes tourPlayMode (re-enter via Tour Events).
function recordTourRound() {
  if (!tourPlayMode) return 0;
  const te = getTourEvent();
  tourPlayMode = false;
  if (!te || (te.rounds || []).length >= 4) return 0;
  te.rounds = te.rounds || [];
  te.rounds.push(round.score || 0);
  setTourEvent(te);
  return te.rounds.length;   // round number just completed (1..4)
}

// PGA-style cut after R2: the field's through-R2 total at position 65 (+ ties).
// Null if the field is too small or no board data. Lower is better.
function tourCutLine() {
  const d = _tourBoardData;
  if (!d) return null;
  const through2 = projectField(d.players, 2).filter((p) => p.total != null);
  const CUT_POS = 65;   // PGA Tour: top 65 and ties
  if (through2.length < 20) return null;
  if (through2.length <= CUT_POS) return through2[through2.length - 1].total;
  return through2[CUT_POS - 1].total;
}
// Did I make the cut? Only meaningful once 2 rounds are banked; before that,
// not blocked. My through-R2 total must be at or better than the cut line.
function tourMadeCut() {
  const te = getTourEvent();
  const r = (te && te.rounds) || [];
  if (r.length < 2) return true;
  const line = tourCutLine();
  if (line == null) return true;
  return (r[0] + r[1]) <= line;
}

// Round-end CTA for a tour round: Next round (R1–R3), See results (R4), or the
// cut verdict after R2 (made → Play R3; missed → See results, event over).
function setupTourRoundEnd(n) {
  const row = document.getElementById("re-tour-row");
  const btn = document.getElementById("re-tour-btn");
  const note = document.getElementById("re-tour-note");
  if (!row || !btn || !note) return;
  if (!n) { row.classList.add("hidden"); return; }
  row.classList.remove("hidden");
  note.textContent = ""; note.className = "re-tour-note";

  const hide = () => document.getElementById("round-end").classList.add("hidden");
  const goResults = () => { hide(); openTourEvents(); };
  const goNext = () => { hide(); teeOffTourRound(); };
  const line = tourCutLine();
  const lineTxt = line != null ? " (cut " + formatToPar(line) + ")" : "";

  if (n >= 4) {
    btn.innerHTML = '<span class="ic ic-trophy"></span>See results';
    btn.onclick = goResults;
  } else if (n === 2 && !tourMadeCut()) {
    note.textContent = "Missed the cut" + lineTxt + " — your event is done.";
    note.className = "re-tour-note missed";
    btn.innerHTML = '<span class="ic ic-trophy"></span>See results';
    btn.onclick = goResults;
  } else {
    if (n === 2) { note.textContent = "Made the cut" + lineTxt; note.className = "re-tour-note made"; }
    btn.innerHTML = '<span class="ic ic-flag-checkered"></span>Play Round ' + (n + 1);
    btn.onclick = goNext;
  }
}

// --- Full-screen board (Masters-app style) ---
async function openTourEvents() {
  const ov = document.getElementById("tour-board");
  ov.classList.remove("hidden");
  mode = "tour";
  _tourExpanded = false;   // always open on the leaders view
  elMenu.classList.add("hidden");
  document.getElementById("play-menu") && document.getElementById("play-menu").classList.add("hidden");
  document.getElementById("tb-event").textContent = "Tour Events";
  document.getElementById("tb-status").textContent = "Loading live scores…";
  document.getElementById("tb-list").innerHTML = "";
  document.getElementById("tb-course").textContent = "";

  const data = await fetchTourLeaderboard();
  if (ov.classList.contains("hidden")) return;   // closed while loading
  if (!data) { document.getElementById("tb-status").textContent = "Couldn't reach the tour feed — try again."; return; }

  // Resolve the venue → baked course (for "Tee off").
  const course = await fetchTourCourse(data.eventId);
  if (ov.classList.contains("hidden")) return;   // closed during the course fetch — don't start polling
  data.courseName = course ? course.name : null;
  _tourCourseMatch = course ? matchTourCourse(course.name) : null;
  _tourBoardData = data;
  ensureTourEvent(data.eventId, data.name);

  renderTourBoard(data);
  ensureTourPoll();
}

function _tourRowHTML(p, rank) {
  const flag = p.flag ? '<img class="tb-flag" src="' + escapeHTML(p.flag) + '" alt="">' : '<span class="tb-flag"></span>';
  const nm = escapeHTML(p.name);
  const today = p.today == null ? "—" : '<span class="' + _parClass(p.today) + '">' + _parText(p.today) + "</span>";
  const total = '<span class="' + _parClass(p.total) + '">' + _parText(p.total) + "</span>";
  return '<tr class="' + (p.isMe ? "tb-me" : "") + '">' +
    '<td class="tb-pos">' + rank + "</td>" +
    '<td class="tb-name">' + flag + nm + "</td>" +
    '<td class="tb-today">' + today + "</td>" +
    '<td class="tb-thru">' + (p.thru == null ? "—" : p.thru) + "</td>" +
    '<td class="tb-total">' + total + "</td></tr>";
}

function renderTourBoard(data) {
  const n = tourDisplayRound();
  const cut = n >= 2 ? tourCutLine() : null;
  document.getElementById("tb-event").textContent = data.name;
  document.getElementById("tb-status").textContent =
    (n === 1 ? "Round 1" : "Rounds 1–" + n + " · aggregate") +
    (cut != null ? " · Cut " + formatToPar(cut) : "") +
    (data.state === "in" && data.round === n ? " · Live" : "");
  document.getElementById("tb-course").textContent = data.courseName || "";

  // From R3 on, only players who made the cut (reached round n) remain.
  let field = projectField(data.players, n);
  if (n >= 3) field = field.filter((p) => (p.rounds || []).some((r) => r.n >= n));
  const merged = mergeMeIntoField(field, data.eventId);
  const LEAD = 15;
  let shown = _tourExpanded ? merged : merged.slice(0, LEAD);
  const meIdx = merged.findIndex((p) => p.isMe);
  let appendedMe = false;
  if (!_tourExpanded && meIdx >= LEAD) { shown = shown.concat([merged[meIdx]]); appendedMe = true; }

  const list = document.getElementById("tb-list");
  list.innerHTML = shown.map((p, i) => {
    const rank = (appendedMe && i === shown.length - 1) ? meIdx + 1 : i + 1;
    return _tourRowHTML(p, rank);
  }).join("");

  const exp = document.getElementById("tb-expand");
  if (exp) {
    exp.classList.toggle("hidden", merged.length <= LEAD);
    exp.textContent = _tourExpanded ? "Show leaders" : "Show full field (" + merged.length + ")";
  }
  const tee = document.getElementById("tb-tee");
  if (tee) {
    if (_tourCourseMatch && !tourPlayMode) {   // can't start a new round mid-round
      tee.classList.remove("hidden");
      const rn = ((getTourEvent() || {}).rounds || []).length + 1;
      const missedCut = rn >= 3 && !tourMadeCut();
      tee.textContent = rn > 4 ? "Event complete" : missedCut ? "Missed the cut" : "Tee off Round " + rn;
      tee.disabled = rn > 4 || missedCut;
    } else {
      tee.classList.add("hidden");
    }
  }
}

function hideTourBoard() { document.getElementById("tour-board").classList.add("hidden"); }
function closeTourEvents() {
  hideTourBoard();
  // Opened mid-round (e.g. tapped the scorebug to glance)? Resume the round
  // instead of routing through showMenu(), which would abandon it.
  if (tourPlayMode && mode === "tour") { mode = "course"; updateTourBug(); return; }
  stopTourPoll();
  if (mode === "tour") showMenu();
}

function teeOffTourRound() {
  const data = _tourBoardData;
  if (!data || !_tourCourseMatch) return;
  const rounds = ((getTourEvent() || {}).rounds) || [];
  if (rounds.length >= 4) return;
  if (rounds.length === 2 && !tourMadeCut()) return;   // missed the cut — no R3/R4
  hideTourBoard();
  selectedCourseId = _tourCourseMatch.id;
  _tourCourseId = _tourCourseMatch.id;   // free taste — event venue plays free
  tourPlayMode = true;
  ensureTourEvent(data.eventId, data.name);
  startCourse();
  ensureTourPoll();
  updateTourBug();
}

// --- Live polling (only refetches while an event is actually in progress) ---
function ensureTourPoll() {
  if (_tourPoll) return;
  _tourPoll = setInterval(async () => {
    if (!_tourBoardData || _tourBoardData.state !== "in") return;
    const data = await fetchTourLeaderboard();
    if (!data) return;
    data.courseName = _tourBoardData.courseName;
    _tourBoardData = data;
    if (!document.getElementById("tour-board").classList.contains("hidden")) renderTourBoard(data);
    updateTourBug();
  }, 60000);
}
function stopTourPoll() { if (_tourPoll) { clearInterval(_tourPoll); _tourPoll = null; } }

// --- Persistent bottom-left scorebug (TV lower-third) ---
function _bugRowHTML(rank, p) {
  const nm = escapeHTML(p.name);
  const total = '<span class="' + _parClass(p.total) + '">' + _parText(p.total) + "</span>";
  return '<div class="tbug-row ' + (p.isMe ? "tbug-me" : "") + '">' +
    '<span class="tbug-pos">' + rank + "</span>" +
    '<span class="tbug-name">' + nm + "</span>" +
    '<span class="tbug-thru">' + (p.thru == null ? "" : p.thru) + "</span>" +
    '<span class="tbug-total">' + total + "</span></div>";
}
function updateTourBug() {
  const bug = document.getElementById("tour-bug");
  if (!bug) return;
  const show = tourPlayMode && mode === "course" && _tourBoardData;
  bug.classList.toggle("hidden", !show);
  if (!show) return;
  const data = _tourBoardData;
  const n = tourDisplayRound();
  let field = projectField(data.players, n);
  if (n >= 3) field = field.filter((p) => (p.rounds || []).some((r) => r.n >= n));
  const merged = mergeMeIntoField(field, data.eventId);
  const meIdx = merged.findIndex((p) => p.isMe);
  const rows = [];
  for (let i = 0; i < Math.min(3, merged.length); i++) rows.push([i + 1, merged[i]]);
  if (meIdx >= 3) rows.push([meIdx + 1, merged[meIdx]]);
  bug.querySelector(".tbug-head").textContent =
    data.name + " · " + (n === 1 ? "Round 1" : "Rds 1–" + n);
  bug.querySelector(".tbug-list").innerHTML = rows.map(([r, p]) => _bugRowHTML(r, p)).join("");

  const cutEl = bug.querySelector(".tbug-cut");
  const cut = n >= 2 ? tourCutLine() : null;
  if (cut != null) {
    const made = tourMadeCut();
    cutEl.innerHTML = 'Cut <b>' + formatToPar(cut) + '</b>' +
      '<span class="' + (made ? "tbug-made" : "tbug-missed") + '">' + (made ? "✓ made" : "✗ missed") + "</span>";
    cutEl.classList.remove("hidden");
  } else {
    cutEl.classList.add("hidden");
  }
}

(function wireTourEvents() {
  const close = document.getElementById("tb-close");
  if (close) close.addEventListener("click", closeTourEvents);
  const exp = document.getElementById("tb-expand");
  if (exp) exp.addEventListener("click", () => { _tourExpanded = !_tourExpanded; if (_tourBoardData) renderTourBoard(_tourBoardData); });
  const tee = document.getElementById("tb-tee");
  if (tee) tee.addEventListener("click", teeOffTourRound);
  const bug = document.getElementById("tour-bug");
  if (bug) bug.addEventListener("click", () => { openTourEvents(); });
})();

// --- Wire-up ---
(function wireTournament() {
  const ot = document.getElementById("open-tournaments");
  if (ot) ot.addEventListener("click", openTournamentLobby);

  const tour = document.getElementById("open-tour");
  if (tour) tour.addEventListener("click", openTourWeek);
  const twClose = document.getElementById("tw-close");
  if (twClose) twClose.addEventListener("click", closeTourWeek);

  const tlClose = document.getElementById("tl-close");
  if (tlClose) tlClose.addEventListener("click", closeTournamentLobby);

  const tlStart = document.getElementById("tl-start");
  if (tlStart) tlStart.addEventListener("click", async () => {
    if (!isTournamentAdmin()) return;   // gate: admins only
    if (activeTournament && tournamentPhase(activeTournament) !== "complete" &&
        !confirm("A tournament is still in progress. Start a new one anyway? (Players will move to the new tournament.)")) return;
    const courseName = (COURSES.find(c => c.id === selectedCourseId) || {}).name || selectedCourseId;
    const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const name = courseName + " — " + dateStr;
    document.getElementById("tl-name").textContent = "Creating…";
    document.getElementById("tl-start").classList.add("hidden");
    const t = await createTournament(name, selectedCourseId);
    if (t) {
      activeTournament = t;
      openTournamentLobby();
    } else {
      document.getElementById("tl-name").textContent = "Failed to create tournament";
      document.getElementById("tl-status").textContent = "Check Supabase permissions";
    }
  });

  const tfClose = document.getElementById("tf-close");
  if (tfClose) tfClose.addEventListener("click", () => {
    document.getElementById("tournament-final").classList.add("hidden");
    mode = "menu";
    elMenu.classList.remove("hidden");
    elHudBtn.classList.add("hidden");
    elHmClubRow.classList.add("hidden");
    closeHud();
    elScorecard.style.display = "none";
  });

  const tsCont = document.getElementById("ts-continue");
  if (tsCont) tsCont.addEventListener("click", closeStandingsToMenu);
})();

// =====================================================================
//  Multiplayer matches — live, code-based games against friends.
//  Flow: host "Start a match" → gets a 6-char code → friends "Join" with it
//  → everyone watches the lobby roster fill → host presses Begin, picks a
//  course + settings + length (9/18) → match goes live → all players race
//  the same course while a standings panel polls scores. Conditions freeze
//  at Begin. Sync is REST polling (no Realtime), mirroring tournaments.
//  Backed by the `matches` + `match_players` tables (see schema.sql).
// =====================================================================
let _matchPoll = null;   // lobby roster/status poll (2s)
let _boardPoll = null;   // in-round standings poll (5s)
let _matchIsHost = false;
let _matchSetupSettings = null;   // settings draft while host configures a match

// 6-char join code from an unambiguous alphabet (no 0/O/1/I/l).
function genMatchCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}

// --- REST helpers (mirror the tournament helpers' shape) ---
async function createMatch() {
  if (!LB_ON()) return null;
  const body = {
    code: genMatchCode(),
    host_name: getPlayerName() || "Host",
    host_user_id: (currentUser() || {}).id || null,
    status: "lobby",
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(LB_URL + "/rest/v1/matches", {
        method: "POST",
        headers: authHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify(body),
      });
      if (res.ok) { const rows = await res.json(); track("match_created"); return rows[0] || null; }
      if (res.status === 409) { body.code = genMatchCode(); continue; }  // code collision
      return null;
    } catch (e) { console.warn("createMatch failed:", e); return null; }
  }
  return null;
}

async function fetchMatchByCode(code) {
  if (!LB_ON()) return null;
  try {
    const q = "/rest/v1/matches?code=eq." + encodeURIComponent(code) + "&limit=1";
    const res = await fetch(LB_URL + q, { headers: lbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch (e) { return null; }
}

async function fetchMatchById(id) {
  if (!LB_ON() || !id) return null;
  try {
    const q = "/rest/v1/matches?id=eq." + encodeURIComponent(id) + "&limit=1";
    const res = await fetch(LB_URL + q, { headers: lbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch (e) { return null; }
}

// The immutable primary key of MY match_players row. All my writes key off this,
// captured at insert — because user_id (may be null at insert) and player_name
// (display_name hydrates async) can both drift between insert and write time, and
// a filter miss silently no-ops (PATCH → 204 over 0 rows). Row id can't drift.
let _myMatchRowId = null;

// Insert (or re-affirm, on rejoin) the current player's row in a match.
async function addMatchPlayer(matchId) {
  if (!LB_ON() || !matchId) return false;
  _myMatchRowId = null;   // fresh join → forget any prior match's row id
  const body = {
    match_id: matchId,
    user_id: (currentUser() || {}).id || null,
    player_name: getPlayerName() || "Player",
  };
  try {
    const res = await fetch(LB_URL + "/rest/v1/match_players", {
      method: "POST",
      // merge-duplicates on the (match_id, player_name) unique key → idempotent rejoin
      headers: authHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    const rows = await res.json().catch(() => []);
    if (rows && rows[0] && rows[0].id) _myMatchRowId = rows[0].id;   // key all future writes off this
    return true;
  } catch (e) { console.warn("addMatchPlayer failed:", e); return false; }
}

// Resolve the PostgREST filter that targets MY row: prefer the captured immutable
// id; else find my row among the live rows via isMeEntry and cache its id; else a
// best-effort identity filter. Returns e.g. "&id=eq.<uuid>" or null if unresolvable.
async function myMatchRowFilter() {
  if (_myMatchRowId) return "&id=eq." + encodeURIComponent(_myMatchRowId);
  const rows = await fetchMatchPlayers(activeMatch.id).catch(() => null);
  if (rows && rows.length) {
    const mine = rows.find(isMeEntry) ||
      rows.find((r) => sameName(r.player_name, getPlayerName()));
    if (mine && mine.id) { _myMatchRowId = mine.id; return "&id=eq." + encodeURIComponent(mine.id); }
  }
  const u = currentUser();
  if (u && u.id) return "&user_id=eq." + encodeURIComponent(u.id);
  const nm = getPlayerName();
  return nm ? "&player_name=eq." + encodeURIComponent(nm) : null;
}

async function fetchMatchPlayers(matchId) {
  if (cpuMatch) return cpuMatchRows();   // local bot match → no DB, synthesize rows
  if (!LB_ON() || !matchId) return [];
  try {
    const q = "/rest/v1/match_players?match_id=eq." + encodeURIComponent(matchId) +
              "&order=score.asc,holes_played.desc,joined_at.asc";
    const res = await fetch(LB_URL + q, { headers: lbHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch (e) { return []; }
}

async function beginMatch(courseId, holeCount, settings, format, live) {
  if (!LB_ON() || !activeMatch) return false;
  track("match_start", { kind: live ? "live" : "async", format, holes: holeCount });
  const validFormat = ["match", "skins", "ctp"].includes(format) ? format : "stroke";
  const patch = {
    course_id: courseId,
    hole_count: holeCount,
    settings: normalizeSettings(settings),
    format: validFormat,
    live: !!live,   // 1v1 turn-based; works for any format
    status: "live",
    started_at: new Date().toISOString(),
  };
  try {
    const res = await fetch(LB_URL + "/rest/v1/matches?id=eq." + encodeURIComponent(activeMatch.id), {
      method: "PATCH",
      headers: authHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) return false;
    const rows = await res.json();
    if (rows && rows[0]) activeMatch = rows[0];
    return true;
  } catch (e) { console.warn("beginMatch failed:", e); return false; }
}

// PATCH my row in match_players with an arbitrary field set. Retries a couple of
// times on failure so a transient blip doesn't drop a turn-critical write (a lost
// write is what deadlocks the live turn gate).
async function patchMyMatchRow(fields) {
  if (cpuMatch) return;              // local bot match → nothing to persist
  if (!LB_ON() || !activeMatch) return;
  const body = JSON.stringify(Object.assign({ cur_updated: new Date().toISOString() }, fields));
  for (let attempt = 0; attempt < 3; attempt++) {
    const filter = await myMatchRowFilter();
    if (!filter) { await new Promise(r => setTimeout(r, 250 * (attempt + 1))); continue; }
    const q = "/rest/v1/match_players?match_id=eq." + encodeURIComponent(activeMatch.id) + filter;
    try {
      // return=representation so we can SEE whether a row was actually updated —
      // a 204 over 0 rows (stale filter) reads as success but writes nothing.
      const res = await fetch(LB_URL + q, {
        method: "PATCH", headers: authHeaders({ Prefer: "return=representation" }), body,
      });
      if (res.ok) {
        const rows = await res.json().catch(() => []);
        if (rows && rows.length) { if (rows[0].id) _myMatchRowId = rows[0].id; return; }
        _myMatchRowId = null;   // matched nothing → cached key was wrong; re-resolve next attempt
      }
    } catch (e) { /* network blip → retry */ }
    await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
  }
  console.warn("match row update failed — no row matched my identity");
}

// Push my running score/progress (called every hole + on finish).
function updateMyMatchProgress(score, holesPlayed, finished) {
  return patchMyMatchRow({ score, holes_played: holesPlayed, finished: !!finished,
                           updated_at: new Date().toISOString() });
}

// Push my live shot state so the opponent panel + honors update. `extra` lets
// callers override fields (e.g. cur_at_rest:false on launch).
function pushMatchShot(extra) {
  if (!matchLive() || !HOLE || HOLE.isRange) return;
  const b = state.ball;
  const toPin = Math.round(dist(b.x, b.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT);
  const fields = {
    cur_hole: HOLE.num, cur_strokes: state.strokes,
    cur_to_pin: toPin, cur_lie: lieLabel(), cur_at_rest: true,
    cur_x: b.x, cur_y: b.y,
  };
  // Live match: remember where my shot started so the at-rest push can describe
  // the full arc (start → rest), which the opponent replays as a tween.
  if (extra && extra.cur_at_rest === false) {
    _shotFrom = { x: b.x, y: b.y };   // ball hasn't moved yet → this is the launch point
    _shotT0 = performance.now();
    _matchSeq++;
  } else if (liveMatch() && _shotFrom) {
    const distU = dist(_shotFrom.x, _shotFrom.y, b.x, b.y);
    const durMs = Math.max(450, Math.min(4000, performance.now() - _shotT0));
    fields.cur_shot = {
      seq: _matchSeq, hole: HOLE.num,
      fromX: _shotFrom.x, fromY: _shotFrom.y, toX: b.x, toY: b.y,
      durMs: Math.round(durMs), peak: distU * 0.16, lie: lieLabel(),
    };
    _shotFrom = null;
  }
  patchMyMatchRow(Object.assign(fields, extra || {}));
  updateLiveTurnUI();
}

// --- helpers shared with startCourse/play-again ---
function roundHoleCount() {
  if (matchLive() && course) return Math.min(matchHoleCount, course.holes.length);
  return course ? course.holes.length : 18;
}

// Run cb once a player name exists (guests welcome) — gates start/join.
function ensureNameThen(cb) {
  if (getPlayerName()) { cb(); return; }
  openNameEntry(() => cb());
}

// --- Play-mode picker (single "Play" entry → the four round types) ---
function openPlayMenu() {
  const ov = document.getElementById("play-menu");
  if (ov) ov.classList.remove("hidden");
}
function closePlayMenu() {
  const ov = document.getElementById("play-menu");
  if (ov) ov.classList.add("hidden");
}
(function wirePlayMenu() {
  const play = document.getElementById("pm-random");
  if (play) play.addEventListener("click", () => { closePlayMenu(); ensureNameThen(openQuickMatch); });
  const friends = document.getElementById("pm-friends");
  if (friends) friends.addEventListener("click", () => { closePlayMenu(); ensureNameThen(openMatchMenu); });
  const bots = document.getElementById("pm-bots");
  if (bots) bots.addEventListener("click", () => { closePlayMenu(); ensureNameThen(openBotSelect); });
  const solo = document.getElementById("pm-solo");
  if (solo) solo.addEventListener("click", () => { closePlayMenu(); showCourseSelect(); });
  const tour = document.getElementById("pm-tour");
  if (tour) tour.addEventListener("click", () => { closePlayMenu(); openTourEvents(); });
  const back = document.getElementById("pm-back");
  if (back) back.addEventListener("click", () => { closePlayMenu(); showMenu(); });
})();

// --- Match menu (start / join) ---
function openMatchMenu() {
  const ov = document.getElementById("match-menu");
  if (!ov) return;
  document.getElementById("mm-error").classList.add("hidden");
  document.getElementById("mm-code").value = "";
  ov.classList.remove("hidden");
}
function closeMatchMenu() {
  const ov = document.getElementById("match-menu");
  if (ov) ov.classList.add("hidden");
}
function mmError(msg) {
  const el = document.getElementById("mm-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

async function hostStartMatch() {
  if (!LB_ON()) { mmError("Online play isn't configured."); return; }
  mmError("");
  const m = await createMatch();
  if (!m) { mmError("Couldn't start a match. Try again."); return; }
  await addMatchPlayer(m.id);   // host is a competitor too → own roster/score row
  activeMatch = m;
  _matchIsHost = true;
  _matchEntered = false;
  closeMatchMenu();
  openMatchLobby();
}

// Shared join path: the code-entry field (joinMatchFlow) and the challenge-
// link deep link (maybeJoinFromLink) both funnel through here — one place
// that knows what "join by code" means.
async function joinMatchByCode(code) {
  if (!LB_ON()) return { ok: false, reason: "Online play isn't configured." };
  if (!code || code.length < 4) return { ok: false, reason: "Enter the code from the host." };
  const m = await fetchMatchByCode(code);
  if (!m) return { ok: false, reason: "No match with that code." };
  if (m.status !== "lobby") return { ok: false, reason: "That match has already started." };
  const ok = await addMatchPlayer(m.id);
  if (!ok) return { ok: false, reason: "Couldn't join. Try again." };
  activeMatch = m;
  _matchIsHost = (currentUser() && m.host_user_id === currentUser().id);
  _matchEntered = false;
  return { ok: true };
}

async function joinMatchFlow() {
  const code = (document.getElementById("mm-code").value || "").trim().toUpperCase();
  mmError("");
  const res = await joinMatchByCode(code);
  if (!res.ok) { mmError(res.reason); return; }
  closeMatchMenu();
  openMatchLobby();
}

// Frictionless "challenge a friend" link (PRODUCT_STRATEGY.md §7.2): the
// match lobby's "Invite link" button shares this URL; maybeJoinFromLink()
// (called once at boot) picks up ?m=CODE on the receiving end.
function matchInviteUrl(code) { return SHARE_URL + "?m=" + code; }

async function maybeJoinFromLink() {
  const p = new URLSearchParams(location.search);
  const code = (p.get("m") || "").trim().toUpperCase();
  if (!code) return;
  // Strip the param either way so a refresh/share-forward doesn't re-prompt.
  p.delete("m");
  const rest = p.toString();
  history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
  if (activeMatch || !confirm(`Join match ${code}?`)) return;
  ensureNameThen(async () => {
    const res = await joinMatchByCode(code);
    if (!res.ok) { showToast(res.reason, 2400); return; }
    track("match_joined_via_link", { code });
    openMatchLobby();
  });
}

// --- Match lobby (roster + begin/waiting), polled every 2s ---
function openMatchLobby() {
  const ov = document.getElementById("match-lobby");
  if (!ov) return;
  ov.classList.remove("hidden");
  document.getElementById("ml-code").textContent = activeMatch ? activeMatch.code : "——————";
  renderMatchLobby();
  stopMatchPoll();
  _matchPoll = setInterval(renderMatchLobby, 2000);
}
function closeMatchLobby() {
  stopMatchPoll();
  const ov = document.getElementById("match-lobby");
  if (ov) ov.classList.add("hidden");
}
function stopMatchPoll() {
  if (_matchPoll) { clearInterval(_matchPoll); _matchPoll = null; }
}

async function renderMatchLobby() {
  if (!activeMatch) return;
  // Refresh the match row so players see when the host presses Begin.
  const fresh = await fetchMatchById(activeMatch.id);
  if (fresh) activeMatch = Object.assign(activeMatch, fresh);

  if (matchLive() && !_matchEntered) { enterLiveMatch(); return; }

  const players = await fetchMatchPlayers(activeMatch.id);
  const list = document.getElementById("ml-players");
  if (list) {
    list.innerHTML = players.length
      ? players.map(p => {
          const me = isMeEntry(p) ? " ml-me" : "";
          const host = (p.player_name === activeMatch.host_name) ? '<span class="ml-host">HOST</span>' : "";
          return `<li class="ml-player${me}">${esc(p.player_name)}${host}</li>`;
        }).join("")
      : '<li class="ml-player ml-empty">Waiting for players…</li>';
  }
  const field = document.getElementById("ml-field");
  if (field) field.textContent = players.length + " in the lobby";

  const beginBtn = document.getElementById("ml-begin");
  const waiting = document.getElementById("ml-waiting");
  if (_matchIsHost) {
    if (beginBtn) beginBtn.classList.remove("hidden");
    if (waiting) waiting.classList.add("hidden");
  } else {
    if (beginBtn) beginBtn.classList.add("hidden");
    if (waiting) waiting.classList.remove("hidden");
  }
}

// --- Host: configure → pick course → Begin ---
// Format/length come FIRST, then the course picker (so "Play" on a course
// card always means "start"); startCourse() diverts to startConfiguredMatch().
function hostBeginPickCourse() {
  closeMatchLobby();
  openMatchSetup();
}

// Settings + length step, shown from the lobby before the course pick.
// preserve=true (back-navigation from the course picker) keeps prior choices.
async function openMatchSetup(preserve) {
  const ov = document.getElementById("match-setup");
  if (!ov) return;
  hideCourseSelect();
  // Matches always use the admin-set global settings (gameDefaults) — the host
  // only picks course/length/format, not the aids.
  _matchSetupSettings = normalizeSettings(gameDefaults);
  if (!preserve) {
    // length default 18, format default stroke, Live off
    ov.dataset.holes = "18";
    ov.dataset.format = "stroke";
    ov.dataset.live = "0";
  }
  syncMatchLengthButtons();
  syncMatchFormatButtons();
  syncMatchLiveButton();
  ov.classList.remove("hidden");
  // Match play AND live are 1v1 only — both need exactly 2 players present.
  const players = await fetchMatchPlayers(activeMatch ? activeMatch.id : null);
  const twoUp = players.length === 2;
  ov.dataset.two = twoUp ? "1" : "0";
  const fmtBtn = ov.querySelector('.ms-fmt[data-format="match"]');
  const note = document.getElementById("ms-fmt-note");
  if (fmtBtn) fmtBtn.disabled = !twoUp;
  if (!twoUp) { ov.dataset.format = "stroke"; ov.dataset.live = "0"; syncMatchFormatButtons(); }
  if (note) note.textContent = twoUp ? "" : "Match play & live need exactly 2 players";
  syncMatchLiveButton();
}
function syncMatchLengthButtons() {
  const ov = document.getElementById("match-setup");
  const holes = ov.dataset.holes;
  ov.querySelectorAll(".ms-len").forEach(b => b.classList.toggle("active", b.dataset.holes === holes));
}
function syncMatchFormatButtons() {
  const ov = document.getElementById("match-setup");
  const fmt = ov.dataset.format;
  ov.querySelectorAll(".ms-fmt").forEach(b => b.classList.toggle("active", b.dataset.format === fmt));
}
// "Live" toggle — any format, but 1v1 only (the turn/ghost machinery is
// two-player); hidden and forced off unless exactly 2 players are in.
function syncMatchLiveButton() {
  const ov = document.getElementById("match-setup");
  const btn = document.getElementById("ms-live");
  if (!btn) return;
  const can = ov.dataset.two === "1";
  if (!can) ov.dataset.live = "0";
  btn.classList.toggle("hidden", !can);
  btn.classList.toggle("active", can && ov.dataset.live === "1");
}
function closeMatchSetup() {
  const ov = document.getElementById("match-setup");
  if (ov) ov.classList.add("hidden");
}

// "Choose course" — settings are locked in the dataset; head to the picker.
function confirmMatchSetup() {
  matchSetupMode = true;
  closeMatchSetup();
  showCourseSelect();
}

// The host tapped Play on a course card while configuring a match: start it.
async function startConfiguredMatch() {
  const ov = document.getElementById("match-setup");
  const holes = parseInt(ov.dataset.holes, 10) || 18;
  const format = ["match", "skins", "ctp"].includes(ov.dataset.format) ? ov.dataset.format : "stroke";
  const live = ov.dataset.live === "1";   // any format, gated to 1v1 by the toggle
  hideCourseSelect();
  showToast("Starting match…", 1500);
  const ok = await beginMatch(selectedCourseId, holes, _matchSetupSettings, format, live);
  if (!ok) {
    showToast("Couldn't start the match — try again.", 2200);
    matchSetupMode = false;
    openMatchLobby();
    return;
  }
  matchSetupMode = false;
  enterLiveMatch();
}

// Drop into the live round (host after Begin, players when poll sees 'live').
function enterLiveMatch() {
  if (_matchEntered) return;
  _matchEntered = true;
  matchSetupMode = false;
  matchDecided = false;
  matchHoleCount = activeMatch.hole_count || 18;
  selectedCourseId = activeMatch.course_id;
  // reset live-match runtime state for a fresh match
  lastOpp = null; lastMe = null; oppShot = null; _shotFrom = null;
  _lastOppSeq = -1; _matchSeq = 0; _spectating = false; _awaitLive = null;
  _oppUpdatedSeen = null; _oppFreshAt = 0; _liveStartAt = performance.now();  // watchdog clocks
  closeMatchLobby();
  closeMatchSetup();
  closeMatchMenu();
  startCourse();
  startBoardPoll();
  subscribeMatchRealtime(activeMatch.id);   // push updates (latency); poll is the fallback
  autoShowMatchBoard();
}

// --- Live standings panel (toggle from HUD) ---
// Realtime pushes most updates; the interval is a heartbeat fallback that also
// drives the re-assert/watchdog, so it stays modest even in a live match.
function startBoardPoll() {
  stopBoardPoll();
  renderMatchBoard();
  _boardPoll = setInterval(renderMatchBoard, matchLive() ? 3000 : 5000);
}
function stopBoardPoll() {
  if (_boardPoll) { clearInterval(_boardPoll); _boardPoll = null; }
}

// --- Supabase Realtime: push row changes instead of waiting on the poll ---
let _sbClient = null, _rtChannel = null;
function ensureSbClient() {
  if (_sbClient) return _sbClient;
  if (!window.supabase || !window.supabase.createClient) return null;  // CDN not loaded
  try { _sbClient = window.supabase.createClient(LB_URL, LB_KEY); } catch (e) { _sbClient = null; }
  return _sbClient;
}
function subscribeMatchRealtime(matchId) {
  unsubscribeMatchRealtime();
  const c = ensureSbClient();
  if (!c || !matchId) return;   // no client → silently rely on the 3s poll
  try {
    const onChange = () => renderMatchBoard();
    _rtChannel = c.channel("match-" + matchId)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_players", filter: "match_id=eq." + matchId }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: "id=eq." + matchId }, onChange)
      .subscribe((status) => { if (status === "SUBSCRIBED") renderMatchBoard(); });  // catch up on (re)subscribe
  } catch (e) { console.warn("realtime subscribe failed:", e); }
}
function unsubscribeMatchRealtime() {
  if (_rtChannel && _sbClient) { try { _sbClient.removeChannel(_rtChannel); } catch (e) {} }
  _rtChannel = null;
}
// Anchor the standings panel just below the live scorecard so it never
// overlaps Strokes/Score (the scorecard's height varies with viewport).
function anchorMatchBoard() {
  const el = document.getElementById("match-standings");
  const sc = document.getElementById("scorecard");
  if (!el || el.classList.contains("hidden")) return;
  if (sc && !sc.classList.contains("hidden")) {
    el.style.top = Math.round(sc.getBoundingClientRect().bottom + 8) + "px";
  } else {
    el.style.top = ""; // CSS fallback
  }
}
window.addEventListener("resize", anchorMatchBoard);
function toggleMatchBoard(force) {
  const el = document.getElementById("match-standings");
  if (!el) return;
  const show = force != null ? force : el.classList.contains("hidden");
  el.classList.toggle("hidden", !show);
  if (show) { renderMatchBoard(); anchorMatchBoard(); }
}
// 1v1 match play now shows its up/down status right on the scorecard
// (updateScorecard), so the standings panel would just be a redundant popup —
// only auto-open it for multiplayer stroke-play formats. Match play can still
// open it manually from the HUD menu (#hm-match) if you want the opponent's
// per-hole detail.
function autoShowMatchBoard() { if (!matchPlay()) toggleMatchBoard(true); }
// --- Match-play math (pure) ---
// diff>0 = I'm up. thru = holes both completed. decided = closeout reached.
function computeMatchPlay(me, opp, holesTotal) {
  const ms = me.hole_scores || {}, os = opp.hole_scores || {};
  let diff = 0, thru = 0;
  for (const k in ms) {
    if (os[k] == null) continue;
    thru++;
    diff += Math.sign((os[k] | 0) - (ms[k] | 0)); // lower strokes wins the hole
  }
  const remaining = Math.max(0, holesTotal - thru);
  const ad = Math.abs(diff);
  const decided = ad > remaining;
  let status, result = null;
  if (diff > 0) status = diff + " UP"; else if (diff < 0) status = ad + " DN"; else status = "AS";
  if (decided || thru >= holesTotal) {
    if (diff === 0) result = "Halved";
    else {
      const margin = (decided && remaining > 0) ? (ad + "&" + remaining) : (ad + " up");
      result = (diff > 0 ? "Won " : "Lost ") + margin;
    }
  }
  return { diff, thru, remaining, status, decided, result };
}

// Skins: each hole is worth one skin. Strict lowest score wins it outright;
// a tie carries the skin's value into the next hole's pot (a later untied
// hole clears the whole accumulated pot, standard skins rule). N players,
// unlike match play's fixed 1v1 — reuses the same match_players rows the
// ranked stroke-play list already has.
function computeSkins(rows, holesTotal) {
  const won = {};
  for (const r of rows) won[r.player_name] = 0;
  let pot = 0;
  const perHole = [];
  for (let h = 1; h <= holesTotal; h++) {
    const scores = rows.map((r) => ({ r, s: (r.hole_scores || {})[h] }));
    if (scores.some((x) => x.s == null)) { perHole.push({ hole: h, winner: null, pot: null }); continue; } // not everyone in yet
    pot++;
    const min = Math.min(...scores.map((x) => x.s));
    const winners = scores.filter((x) => x.s === min);
    if (winners.length === 1) {
      won[winners[0].r.player_name] += pot;
      perHole.push({ hole: h, winner: winners[0].r.player_name, pot });
      pot = 0;
    } else {
      perHole.push({ hole: h, winner: null, pot }); // tie — pot carries to the next hole
    }
  }
  return { perHole, won, carry: pot };
}

// Closest-to-pin: per hole, whoever's approach finished nearest the cup (first
// time reaching the green that hole — state.proximity, synced as hole_prox)
// wins that hole's point. Holes nobody has a recorded proximity for (missed
// the green, or a bot opponent with no proximity data) are skipped, not
// scored zero.
function computeClosestToPin(rows, holesTotal) {
  const won = {};
  for (const r of rows) won[r.player_name] = 0;
  const perHole = [];
  for (let h = 1; h <= holesTotal; h++) {
    const entries = rows.map((r) => ({ r, p: (r.hole_prox || {})[h] })).filter((x) => x.p != null);
    if (!entries.length) { perHole.push({ hole: h, winner: null }); continue; }
    const min = Math.min(...entries.map((x) => x.p));
    const winner = entries.find((x) => x.p === min).r;
    won[winner.player_name]++;
    perHole.push({ hole: h, winner: winner.player_name, prox: min });
  }
  return { perHole, won };
}

// Match play: end-of-hole outcome + resulting match status ("Hole won · 2 up").
// Null until both players have a recorded score for hole h.
function matchHoleOutcomeText(h) {
  if (!matchPlay() || !lastOpp) return null;
  const me = meSnapshot();
  const mine = me && me.hole_scores[h], theirs = (lastOpp.hole_scores || {})[h];
  if (mine == null || theirs == null) return null;
  const s = Math.sign(theirs - mine);
  const mp = computeMatchPlay(me, lastOpp, matchHoleCount);
  const status = mp.diff > 0 ? mp.diff + " up" : mp.diff < 0 ? (-mp.diff) + " down" : "All square";
  return (s > 0 ? "Hole won" : s < 0 ? "Hole lost" : "Hole halved") + " · " + status;
}

// Match play: once the hole can't be won or halved — the opponent is already in
// with a score my best possible finish (holing the very next stroke) can't
// match — pick up and move on rather than grinding out a dead hole.
function checkHoleConcede() {
  if (!matchPlay() || mode !== "course" || !HOLE || HOLE.isRange) return;
  if (state.inHole || state.moving || holeTransition || matchDecided) return;
  if (round.holeStats.some(s => s.hole === HOLE.num)) return; // hole already recorded
  const theirs = lastOpp && (lastOpp.hole_scores || {})[HOLE.num];
  if (theirs == null || state.strokes < theirs) return; // holing the next stroke could still halve
  state._conceded = true;
  state.strokes += 1;   // the pickup: best-case stroke that still loses the hole
  state.inHole = true;  // hole is over — no more swings
  showResult();
}

// Match play: player-initiated pickup, offered any time mid-hole (not just once
// the hole is mathematically dead) — the real "I'm picking up" call, for a lie
// with no realistic recovery or just not worth playing out. Always registers as
// a loss: at least one more stroke than already taken, and strictly worse than
// the opponent's posted score if they've already finished the hole, so it can
// never accidentally read as a win or halve.
function canForfeitHole() {
  return matchPlay() && mode === "course" && !!HOLE && !HOLE.isRange &&
    !state.inHole && !state.moving && !holeTransition && !matchDecided &&
    !round.holeStats.some(s => s.hole === HOLE.num);
}
function forfeitHole() {
  if (!canForfeitHole()) return;
  const theirs = lastOpp && (lastOpp.hole_scores || {})[HOLE.num];
  state._conceded = true;
  state.strokes = theirs != null ? Math.max(state.strokes + 1, theirs + 1) : state.strokes + 1;
  state.inHole = true;
  showResult();
}

// Advisory honors: who is "away" (farthest from pin). Only meaningful when both
// are at rest on the same hole and neither has holed. Never gates input.
function whoseHonors(me, opp) {
  if (!me || !opp || me.cur_hole == null || me.cur_hole !== opp.cur_hole) return "";
  if (!me.cur_at_rest || !opp.cur_at_rest) return "";
  if ((me.cur_to_pin | 0) < 0 || (opp.cur_to_pin | 0) < 0) return ""; // someone holed
  if (me.cur_to_pin === opp.cur_to_pin) return "";
  return me.cur_to_pin > opp.cur_to_pin ? "Your turn — you're away" : (opp.player_name + " to play (away)");
}

// =====================================================================
//  LIVE (synchronous) match play — turn order, opponent ghost, banner.
//  Both devices derive "whose turn" from the same synced rows, so they agree.
//  Input is gated so only the player who is "away" (farthest from the pin, or
//  the honors-holder on the tee) may swing; the other watches the shot live.
// =====================================================================
let _matchSeq = 0;     // my monotonic shot counter (broadcast in cur_shot.seq)
let _shotFrom = null;  // {x,y} where my in-flight shot started (for the arc)
let _shotT0 = 0;       // performance.now() at launch → real flight duration
let lastOpp = null;    // opponent's last polled match_players row
let lastMe = null;     // my last polled row
let oppShot = null;    // active opponent arc tween, or null
let _lastOppSeq = -1;  // last opponent cur_shot.seq I started animating
let _spectating = false;     // camera is following the opponent's ball
let _awaitLive = null;       // {hole, advance, since} while waiting for opp to finish a hole

// --- Disconnect/deadlock watchdog -------------------------------------------
// The turn gate must NEVER lock both players forever. We track how recently the
// opponent's row actually changed; if they go quiet (slept phone, dropped wifi,
// closed tab) past LIVE_STALE_MS, we release the lock so the game stays playable.
const LIVE_STALE_MS = 15000;     // opponent silent this long → treat as idle, free input
let _oppUpdatedSeen = null;      // last opp cur_updated string we observed
let _oppFreshAt = 0;             // performance.now() when opp last changed
let _liveStartAt = 0;            // performance.now() when we entered the live round

// Is the opponent actively syncing (so turn-gating should be respected)? While
// no opp row exists yet we grant a startup grace window; after that, or once
// their row goes stale, they count as unresponsive and locks are released.
function oppResponsive() {
  const now = performance.now();
  if (!lastOpp) return (now - _liveStartAt) < LIVE_STALE_MS;
  return (now - _oppFreshAt) < LIVE_STALE_MS;
}

function sameName(a, b) { return (a || "").toLowerCase() === (b || "").toLowerCase(); }
function oppName() { return (lastOpp && lastOpp.player_name) || "opponent"; }

// My live shot state from the LOCAL game (no poll lag → input locks instantly
// after I swing, without waiting for my own row to round-trip).
function meSnapshot() {
  if (!HOLE || HOLE.isRange) return null;
  const b = state.ball;
  const hs = {};
  for (const h of round.holeStats) hs[h.hole] = h.strokes;
  return {
    player_name: getPlayerName(),
    cur_hole: HOLE.num,
    cur_strokes: state.strokes,
    cur_to_pin: state.inHole ? -1 : Math.round(dist(b.x, b.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT),
    cur_at_rest: !state.moving,
    hole_scores: hs,
  };
}

// Who tees first this hole: hole 1 → match starter (host); else the winner of the
// most recent decided prior hole (honors carry through halved holes); default host.
function honorsHolder(me, opp, hole) {
  const host = activeMatch && activeMatch.host_name;
  if (hole <= 1) return host;
  const ms = me.hole_scores || {}, os = opp.hole_scores || {};
  for (let h = hole - 1; h >= 1; h--) {
    if (ms[h] == null || os[h] == null) continue;
    if (ms[h] === os[h]) continue;                       // halved → honors carry
    return ms[h] < os[h] ? me.player_name : opp.player_name;
  }
  return host;
}

// Name of the player whose turn it is now, or null while unsynced / hole done.
function liveTurnHolder(me, opp) {
  if (!me || !opp || me.cur_hole == null || opp.cur_hole == null) return null;
  if (me.cur_hole !== opp.cur_hole) return null;          // out of sync → hold
  const hole = me.cur_hole;
  if (opp.cur_at_rest === false) return opp.player_name;  // mid-shot owns the turn
  if (me.cur_at_rest === false) return me.player_name;
  const meHoled = (me.cur_to_pin | 0) < 0, oppHoled = (opp.cur_to_pin | 0) < 0;
  if (meHoled && oppHoled) return null;                   // hole done
  if (meHoled) return opp.player_name;
  if (oppHoled) return me.player_name;
  const teed = (me.cur_strokes | 0) > 0 || (opp.cur_strokes | 0) > 0;
  if (!teed || me.cur_to_pin === opp.cur_to_pin) return honorsHolder(me, opp, hole);
  return me.cur_to_pin > opp.cur_to_pin ? me.player_name : opp.player_name;  // away plays
}

// May I swing right now? Always yes outside a live match.
function myTurn() {
  if (!liveMatch()) return true;
  // Fail-safe: if the opponent has gone quiet, never stay locked — let me play on.
  if (!oppResponsive()) return true;
  const me = meSnapshot();
  if (!me) return true;
  // Cross-hole (desync/recovery): honors/away only apply on the same hole — if we're
  // on different holes, don't gate my own hole.
  if (lastOpp && lastOpp.cur_hole !== me.cur_hole) return true;
  const t = liveTurnHolder(me, lastOpp);
  if (t == null) return false;     // transient unresolved, but opp is live → brief hold
  return sameName(t, me.player_name);
}

// Opponent's current ball position (tween while a shot is in flight, else its
// resting spot), in world units. null when nothing to show on this hole.
function oppGhostPos() {
  if (!lastOpp || !HOLE || lastOpp.cur_hole !== HOLE.num) return null;
  const s = oppShot;
  if (s && s.hole === HOLE.num) {
    const u = Math.min(1, (performance.now() - s.t0) / s.durMs);
    return { x: s.fromX + (s.toX - s.fromX) * u, y: s.fromY + (s.toY - s.fromY) * u,
             z: s.peak * 4 * u * (1 - u), moving: u < 1 };
  }
  if (lastOpp.cur_x != null && (lastOpp.cur_to_pin | 0) >= 0)
    return { x: lastOpp.cur_x, y: lastOpp.cur_y, z: 0, moving: false };
  return null;
}

// Draw the opponent's ball on my canvas (gold, with a name tag). Mirrors the
// player ball+shadow style; lifted by the tween height while their shot flies.
function drawOppGhost() {
  const g = oppGhostPos();
  if (!g) return;
  const gx = wx(g.x, g.y), gy = wyg(g.x, g.y);
  const lift = ws(g.z || 0);
  const baseR = Math.max(ws(BALL_RADIUS_UNITS), 4);
  // shadow on the ground
  ctx.beginPath();
  ctx.ellipse(gx, gy, baseR * 0.95, baseR * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();
  const bx = gx, by = gy - lift;
  const r = baseR * (1 + (g.z || 0) * 0.012);
  const rg = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.35, r * 0.1, bx, by, r);
  rg.addColorStop(0, "#ffe9a8");
  rg.addColorStop(0.6, "#f6c453");
  rg.addColorStop(1, "#c98a1e");
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fillStyle = rg;
  ctx.fill();
  ctx.strokeStyle = "rgba(90,60,10,0.8)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // name tag above the ball — hidden on the green, where the pill would sit
  // right over the cup and hide the hole.
  if (surfaceAt(g.x, g.y) !== "green") drawLabel(bx, by - r - 9, oppName(), "#ffd65a");
}

// Start an arc tween when the opponent broadcasts a new shot on this hole.
function startOppGhost(oppRow) {
  const cs = oppRow && oppRow.cur_shot;
  if (!cs || cs.seq === _lastOppSeq) return;
  _lastOppSeq = cs.seq;
  if (!HOLE || cs.hole !== HOLE.num) return;              // shot is for another hole
  oppShot = { hole: cs.hole, fromX: cs.fromX, fromY: cs.fromY, toX: cs.toX, toY: cs.toY,
              peak: cs.peak || 0, durMs: Math.max(300, cs.durMs || 600), t0: performance.now() };
}

// Has the opponent completed (holed out) the given hole number?
function oppFinishedHole(h) { return !!(lastOpp && (lastOpp.hole_scores || {})[h] != null); }

// Per-frame: follow the opponent's ball while it's their turn; snap back to my
// ball framing when the turn returns to me.
function liveCameraTick() {
  if (!liveMatch() || mode !== "course") { _spectating = false; return; }
  const watch = !myTurn() && lastOpp && lastOpp.cur_hole === (HOLE && HOLE.num);
  if (watch) {
    const g = oppGhostPos();
    if (g) { frameTarget(g.x, g.y); _spectating = true; return; }
  }
  if (_spectating) {
    _spectating = false;
    frameRemaining();
    if (autoAimEnabled) aimAtHole();
  }
}

// Update the whose-turn banner (top-center). Called every frame; only touches the
// DOM when the text/state actually changes.
let _lastTurnKey = "";
function updateLiveTurnUI() {
  const el = document.getElementById("live-turn");
  if (!el) return;
  let txt, cls;
  if (!liveMatch() || mode !== "course") { txt = ""; cls = "hidden"; }
  else {
    const me = meSnapshot();
    const t = liveTurnHolder(me, lastOpp);
    if (!oppResponsive()) { txt = oppName() + " idle"; cls = "lt-mine"; }
    else if (_awaitLive) { txt = "Waiting for " + oppName() + "…"; cls = "lt-wait"; }
    else if (t == null) {
      // No turn holder: the hole is settled on both sides (result modal owns the
      // screen) or rows are briefly out of step. A local bot match never syncs,
      // so "Syncing…" would read as a network stall — hide instead.
      const meHoled = me && (me.cur_to_pin | 0) < 0;
      const oppHoled = lastOpp && (lastOpp.cur_to_pin | 0) < 0;
      if (cpuMatch || (meHoled && oppHoled)) { txt = ""; cls = "hidden"; }
      else { txt = "Syncing…"; cls = "lt-wait"; }
    }
    else if (me && sameName(t, me.player_name)) { txt = "Your turn"; cls = "lt-mine"; }
    else { txt = "Watching " + oppName() + "…"; cls = "lt-wait"; }
  }
  const key = cls + "|" + txt;
  if (key === _lastTurnKey) return;
  _lastTurnKey = key;
  el.textContent = txt;
  el.className = cls;
  if (cls !== "hidden") positionLiveTurn();
}

// The turn banner lives in the bottom-left corner (see hud.css) — clear any
// stale inline positioning so the CSS default governs.
function positionLiveTurn() {
  const el = document.getElementById("live-turn");
  if (!el) return;
  el.style.top = ""; el.style.left = ""; el.style.width = "";
}

// Drive the live features from a fresh poll of the players' rows.
function onLivePoll(rows) {
  if (!liveMatch()) return;
  const meRow = rows.find(isMeEntry), oppRow = rows.find(r => !isMeEntry(r));
  if (meRow) lastMe = meRow;
  if (oppRow) {
    lastOpp = oppRow;
    startOppGhost(oppRow);
    // watchdog: note when the opponent's row actually changed (freshness clock)
    if (oppRow.cur_updated !== _oppUpdatedSeen) { _oppUpdatedSeen = oppRow.cur_updated; _oppFreshAt = performance.now(); }
  }
  reassertMyState();   // re-push my at-rest state so a dropped write self-heals
  checkHoleConcede();  // opp just finished and my hole is dead? pick up
  pumpLiveAdvance();
  updateLiveTurnUI();
  positionLiveTurn();   // standings size may have changed → keep banner anchored under it
}

// When I've holed and tapped "Next hole" but the opponent hasn't finished, hold;
// the poll calls this each tick and advances once they're done — OR once they've
// gone unresponsive past the timeout, so a lost write can't strand me on the hole.
function pumpLiveAdvance() {
  if (!_awaitLive) return;
  const timedOut = !oppResponsive() && (performance.now() - _awaitLive.since) > LIVE_STALE_MS;
  if (oppFinishedHole(_awaitLive.hole) || timedOut) {
    // opponent just wrapped the hole — now the outcome is known; say it on the way out
    const mo = matchHoleOutcomeText(_awaitLive.hole);
    const adv = _awaitLive.advance;
    _awaitLive = null;
    if (mo) showToast(mo, 2000);
    adv();
  }
}

// Re-broadcast my current at-rest state (idempotent) so a single dropped write
// recovers instead of deadlocking the turn. Throttled (min REASSERT_MS apart) so
// Realtime events — which also call onLivePoll — can't trigger a write ping-pong.
const REASSERT_MS = 2500;
let _lastReassertAt = 0;
function reassertMyState(force) {
  if (!liveMatch() || !HOLE || HOLE.isRange) return;
  if (state.moving || state.inHole) return;   // mid-shot/holed states are pushed by their own hooks
  const now = performance.now();
  if (!force && now - _lastReassertAt < REASSERT_MS) return;
  _lastReassertAt = now;
  const me = meSnapshot();
  if (!me) return;
  patchMyMatchRow({ cur_hole: me.cur_hole, cur_strokes: me.cur_strokes,
                    cur_to_pin: me.cur_to_pin, cur_at_rest: true,
                    cur_x: state.ball.x, cur_y: state.ball.y });
}

// On a hole-out, see if the match is mathematically decided (closeout).
async function checkMatchCloseout() {
  if (!matchPlay()) return;
  const rows = await fetchMatchPlayers(activeMatch.id);
  const me = rows.find(isMeEntry), opp = rows.find(r => !isMeEntry(r));
  if (!me || !opp) return;
  const mp = computeMatchPlay(me, opp, matchHoleCount);
  if (mp.decided) { matchDecided = true; updateMyMatchProgress(round.score, round.holesPlayed, true); }
  renderMatchBoard();   // keeps the (manually-openable) panel's content fresh
}

async function renderMatchBoard() {
  if (!activeMatch) return;
  const rows = await fetchMatchPlayers(activeMatch.id);
  onLivePoll(rows);   // drive live turn order / opponent ghost / hole-advance sync — needed every
                      // poll regardless of panel visibility, so this always runs
  // Keep the scorecard's 1v1 up/down status fresh straight from the poll. onLivePoll
  // only wires lastOpp for turn-based (Live) matches, and updateScorecard() otherwise
  // only runs on my own hole events — so without this the opponent's progress never
  // showed until I acted. Covers async match-play too.
  if (matchPlay() && mode === "course") {
    if (!liveMatch()) { const opp = rows.find((r) => !isMeEntry(r)); if (opp) lastOpp = opp; }
    updateScorecard();
  }
  const panel = document.getElementById("match-standings");
  if (!panel || panel.classList.contains("hidden")) return; // board UI closed — skip the innerHTML rebuild below
  const title = document.getElementById("mb-title");
  const body = document.getElementById("mb-list");
  if (!body) return;

  // --- 1v1 match-play view: status + live opponent + honors ---
  if (matchPlay()) {
    const me = rows.find(isMeEntry), opp = rows.find(r => !isMeEntry(r));
    if (!me || !opp) {
      if (title) title.textContent = "Match play";
      body.innerHTML = '<div class="mb-row mb-empty">Waiting for opponent…</div>';
      return;
    }
    const mp = computeMatchPlay(me, opp, matchHoleCount);
    if (mp.decided) matchDecided = true;
    if (title) title.textContent = mp.result ? "Match: " + mp.result : "Match play";
    const honors = whoseHonors(me, opp);
    // Show what the opponent scored on the hole I'M currently playing (from their
    // hole_scores, written on hole-out) — not their live state on their own hole.
    const curHole = (typeof HOLE !== "undefined" && HOLE && HOLE.num) || (round.holesPlayed + 1);
    const curPar = (typeof HOLE !== "undefined" && HOLE && HOLE.par) || 0;
    const os = (opp.hole_scores || {})[curHole];
    let oppLine;
    if (os != null) {
      const rel = (os | 0) - curPar;
      const tag = curPar ? (rel === 0 ? "E" : (rel > 0 ? "+" + rel : String(rel))) : "";
      oppLine = `Hole ${curHole}: ${os | 0}${tag ? " (" + tag + ")" : ""}`;
    } else {
      oppLine = `Hole ${curHole}: yet to play`;
    }
    body.innerHTML =
      `<div class="mb-status">${esc(mp.result || mp.status)} · thru ${mp.thru}</div>` +
      `<div class="mb-opp">` +
        `<div class="mb-opp-name">${esc(opp.player_name)}${cpuMatch ? ' <span class="cpu-chip">CPU</span>' : ""}</div>` +
        `<div class="mb-opp-line">${esc(oppLine)}</div>` +
      `</div>` +
      (honors ? `<div class="mb-honors">${esc(honors)}</div>` : "");
    return;
  }

  // --- stroke play: sorted standings (positions w/ ties, "F" when done) ---
  const ranked = rankMatchRows(rows);
  const allDone = ranked.length && ranked.every(r => r.finished);
  if (title) title.textContent = allDone ? "Final standings" : "Match standings";
  body.innerHTML = ranked.map(r => {
    const me = isMeEntry(r) ? " mb-me" : "";
    const lead = r.pos === 1 ? " mb-lead" : "";
    const thru = r.finished ? '<span class="mb-fin">F</span>' : `${r.holes_played}/${matchHoleCount}`;
    return `<div class="mb-row${me}${lead}">` +
             `<span class="mb-pos">${posLabel(r)}</span>` +
             `<span class="mb-name">${esc(r.player_name)}${cpuMatch && !isMeEntry(r) ? ' <span class="cpu-chip">CPU</span>' : ""}</span>` +
             `<span class="mb-score">${formatToPar(r.score)}</span>` +
             `<span class="mb-thru">${thru}</span>` +
           `</div>`;
  }).join("") || '<div class="mb-row mb-empty">No scores yet</div>';
}

// =====================================================================
//  Match results landing page — full-screen live scoreboard shown after a
//  player confirms their scorecard. Auto-polls until everyone's finished,
//  then locks in final placement.
// =====================================================================
let _resultsPoll = null;
function stopResultsPoll() { if (_resultsPoll) { clearInterval(_resultsPoll); _resultsPoll = null; } }

function openMatchResults() {
  markMatchDone();   // I've confirmed my card → flag the match finished (H2H, cleanup)
  if (activeMatch && activeMatch._bot) settleBotMatch();
  stopBoardPoll();
  toggleMatchBoard(false);
  document.getElementById("round-end").classList.add("hidden");
  const ov = document.getElementById("match-results");
  if (ov) ov.classList.remove("hidden");
  renderMatchResults();
  stopResultsPoll();
  _resultsPoll = setInterval(renderMatchResults, 4000);
}
function closeMatchResults() {
  stopResultsPoll();
  const ov = document.getElementById("match-results");
  if (ov) ov.classList.add("hidden");
  // Rematch button state is per-match — never leak into the next match's results.
  const rm = document.getElementById("mr-rematch"), nb = document.getElementById("mr-next-bot");
  if (rm) { rm.classList.add("hidden"); delete rm.dataset.human; }
  if (nb) nb.classList.add("hidden");
}

// Ladder settlement: runs once when a bot match reaches the results screen
// (both end paths funnel here — scorecard confirm and early closeout).
// Win = match-play victory; halved/lost don't advance the ladder.
function settleBotMatch() {
  const rows = cpuMatchRows();          // [me, cpuOpp] — synchronous, offline-safe
  const mp = computeMatchPlay(rows[0], rows[1], matchHoleCount);
  const won = !!(mp && mp.result && mp.result.indexOf("Won") === 0);
  if (won && markBotBeaten(activeMatch._bot)) {
    const next = nextBotAfter(activeMatch._bot);
    showToast(next ? next.name + " unlocked" : "Ladder complete — you beat them all", 2800, "gold");
    // This bot's course tier just opened — tell the player what they won.
    const tier = botIndex(activeMatch._bot);
    let n = 0;
    courseTierMap().forEach((t, cid) => { if (t === tier) { n++; track("course_unlocked", { course: cid, via: "bot" }); } });
    if (n) setTimeout(() => showToast(n + " new course" + (n === 1 ? "" : "s") + " unlocked", 2600, "gold"), 3200);
  }
  if (won && earnMilestone("match-win")) announceMilestoneUnlocks("match-win", 6000);
  const nb = nextBotAfter(activeMatch._bot);
  const rm = document.getElementById("mr-rematch"), nbBtn = document.getElementById("mr-next-bot");
  if (rm) rm.classList.remove("hidden");
  if (nbBtn) nbBtn.classList.toggle("hidden", !(won && nb));
}

// Start another ladder match from the results screen (Rematch / Next bot).
function startBotFromResults(bot) {
  if (!bot) return;
  const holes = matchHoleCount;
  leaveMatch();                         // resets cpuMatch/cpuOpp/activeMatch, closes results
  closeHud();
  elScorecard.style.display = "none";
  startCpuMatch("match", holes, bot);
}

// Rematch for a finished human-vs-human match (§5/§7.2 "rematch loop" — the
// bot ladder already had one, human matches didn't). No assumption the
// opponent is a known friend: opens a fresh lobby under a new code so the
// host can re-share it (Copy code / Invite link, both already live there)
// with whoever they just played.
async function rematchHumanMatch() {
  leaveMatch();
  closeHud();
  elScorecard.style.display = "none";
  if (!LB_ON()) { showToast("Online play isn't configured.", 2000); return; }
  const m = await createMatch();
  if (!m) { showToast("Couldn't start a rematch. Try again.", 2200); return; }
  await addMatchPlayer(m.id);   // host is a competitor too → own roster/score row
  activeMatch = m;
  _matchIsHost = true;
  _matchEntered = false;
  openMatchLobby();
}

async function renderMatchResults() {
  if (!activeMatch) return;
  const rows = await fetchMatchPlayers(activeMatch.id);
  const allDone = rows.length && rows.every(r => r.finished);
  const titleEl = document.getElementById("mr-title");
  const subEl = document.getElementById("mr-sub");
  const bannerEl = document.getElementById("mr-banner");
  const listEl = document.getElementById("mr-list");
  if (!listEl) return;
  if (titleEl) titleEl.textContent = allDone ? "Final standings" : "Match standings";
  if (subEl) subEl.textContent = allDone
    ? "Match complete"
    : `${rows.filter(r => r.finished).length}/${rows.length} in the clubhouse`;
  // Human rematch (§5/§7.2 "rematch loop"): a finished human-vs-human match
  // (not the bot ladder, not a Quick Match CPU fallback — both set cpuMatch)
  // gets a plain Rematch button. settleBotMatch() handles the ladder's own
  // Rematch/Next-bot visibility separately when activeMatch._bot is set.
  if (allDone && !cpuMatch) {
    const rm = document.getElementById("mr-rematch");
    if (rm) { rm.dataset.human = "1"; rm.classList.remove("hidden"); }
  }

  // Full per-hole scorecard only once everyone's holed out; live poll fills it in.
  const scEl = document.getElementById("mr-scorecard");
  if (scEl) scEl.innerHTML = allDone ? buildMatchScorecard(rows) : "";

  // 1v1 match-play has its own win/loss verdict.
  if (matchPlay()) {
    const me = rows.find(isMeEntry), opp = rows.find(r => !isMeEntry(r));
    const mp = (me && opp) ? computeMatchPlay(me, opp, matchHoleCount) : null;
    if (bannerEl) bannerEl.textContent = mp ? (mp.result || mp.status || "") : "";
    // First quick-match win → milestone (idempotent, safe under the results poll).
    if (allDone && mp && mp.result && mp.result.indexOf("Won") === 0 && earnMilestone("match-win")) {
      showToast("First match win!", 2200, "gold");
      announceMilestoneUnlocks("match-win", 2600);
    }
    listEl.innerHTML = rows.map(r => {
      const meCls = isMeEntry(r) ? " mr-me" : "";
      const thru = r.finished ? '<span class="mr-fin">F</span>' : `${r.holes_played}/${matchHoleCount}`;
      return `<div class="mr-row${meCls}">` +
               `<span class="mr-pos"></span>` +
               `<span class="mr-name">${esc(r.player_name)}${cpuMatch && !isMeEntry(r) ? ' <span class="cpu-chip">CPU</span>' : ""}</span>` +
               `<span class="mr-score">${formatToPar(r.score)}</span>` +
               `<span class="mr-thru">${thru}</span>` +
             `</div>`;
    }).join("");
    return;
  }

  // Stroke play: ranked standings + the player's live position.
  const ranked = rankMatchRows(rows);
  const meRow = ranked.find(isMeEntry);
  if (bannerEl) {
    if (!meRow) bannerEl.textContent = "";
    else if (allDone) bannerEl.textContent = `You finished ${posLabel(meRow)}` +
      (meRow.pos === 1 && !meRow.tied ? " — winner!" : "");
    else if (meRow.finished) bannerEl.textContent = `In the clubhouse — currently ${posLabel(meRow)}`;
    else bannerEl.textContent = `You're ${posLabel(meRow)}`;
  }
  // First quick-match win (stroke play) → milestone (idempotent under the poll).
  if (allDone && meRow && meRow.pos === 1 && !meRow.tied && earnMilestone("match-win")) {
    showToast("First match win!", 2200, "gold");
    announceMilestoneUnlocks("match-win", 2600);
  }
  // Skins / closest-to-pin: same ranked stroke-play list as the base game,
  // plus a pot/point leader banner and a per-hole breakdown appended under
  // the scorecard once the match ends (§5/§7.2 new formats).
  if (activeMatch.format === "skins" || activeMatch.format === "ctp") {
    const isSkins = activeMatch.format === "skins";
    const calc = isSkins ? computeSkins(rows, matchHoleCount) : computeClosestToPin(rows, matchHoleCount);
    const leaderName = Object.keys(calc.won).sort((a, b) => calc.won[b] - calc.won[a])[0];
    const leaderCount = calc.won[leaderName] || 0;
    if (bannerEl && allDone) {
      bannerEl.textContent = leaderCount
        ? `${leaderName} leads ${isSkins ? "skins" : "closest-to-pin"} — ${leaderCount}`
        : (isSkins ? "No skins won — every hole tied" : "No proximity data recorded");
    }
    if (scEl && allDone) {
      const label = isSkins ? "Skins" : "Closest-to-pin";
      const won = calc.perHole.filter((h) => h.winner);
      scEl.innerHTML += won.length ? `<div class="mr-fmt-breakdown"><div class="mr-fmt-title">${label} by hole</div>` +
        won.map((h) =>
          `<div class="mr-fmt-row"><span>Hole ${h.hole}</span><span>${esc(h.winner)}${isSkins && h.pot > 1 ? " ×" + h.pot : ""}</span></div>`
        ).join("") + `</div>` : "";
    }
  }
  listEl.innerHTML = ranked.map(r => {
    const meCls = isMeEntry(r) ? " mr-me" : "";
    const win = allDone && r.pos === 1;
    const thru = r.finished ? '<span class="mr-fin">F</span>' : `${r.holes_played}/${matchHoleCount}`;
    return `<div class="mr-row${meCls}${win ? " mr-win" : ""}">` +
             `<span class="mr-pos">${posLabel(r)}</span>` +
             `<span class="mr-name">${esc(r.player_name)}${cpuMatch && !isMeEntry(r) ? ' <span class="cpu-chip">CPU</span>' : ""}${win ? ' <span class="ic ic-trophy mr-trophy"></span>' : ""}</span>` +
             `<span class="mr-score">${formatToPar(r.score)}</span>` +
             `<span class="mr-thru">${thru}</span>` +
           `</div>`;
  }).join("") || '<div class="mr-row mb-empty">No scores yet</div>';
}

// Tear down all match state (Home button, leaving a match).
function leaveMatch() {
  stopMatchPoll();
  stopBoardPoll();
  unsubscribeMatchRealtime();
  closeMatchResults();
  stopQuickMatch();
  activeMatch = null;
  matchSetupMode = false;
  _matchEntered = false;
  _matchIsHost = false;
  matchDecided = false;
  matchHoleCount = 18;
  cpuMatch = false;
  cpuOpp = null;
  toggleMatchBoard(false);
}

// =====================================================================
//  QUICK MATCH — chess.com-style open matchmaking.
//  Pick format (match/stroke) + length (9/18), then queue. The find_quick_match
//  RPC atomically pairs the oldest waiter within a handicap band (the "Elo");
//  the band widens over ~7s, and with no human by ~10s we drop into a local CPU
//  opponent. Handicap = best-8-of-20 to-par (guests get a default). Pairing
//  handshake: the caller whose RPC returns a match is the "joiner" and drives
//  beginMatch (course/settings); the waiter, seeing its queue row flip to
//  'matched', waits for the match to go live and enters. Both land in the same
//  live-match runtime already used by friend matches.
// =====================================================================
const QM_DEFAULT_HCP = 18;   // guests / no-history players
const QM_POLL_MS   = 1500;   // matchmaking tick + live-wait poll
const QM_CPU_MIN_MS = 6000;  // CPU fallback threshold is rolled per search
const QM_CPU_MAX_MS = 18000; //   (6-18s) so the wait length never repeats
const QM_LIVE_TRIES = 8;     // waiter polls ~12s for the joiner to go live, else self-begins
let _qm = null;              // active matchmaking session, or null
let _qmHcp = QM_DEFAULT_HCP; // my resolved pairing handicap for this session

// Handicap band widens the longer you wait (tight → any).
function qmBandFor(elapsed) {
  if (elapsed < 4000) return 5;
  if (elapsed < 7000) return 15;
  return 999;   // any handicap
}
function qmPickCourse() {
  const ids = unlockedCourseIds();
  const list = ids.length ? ids : FREE_COURSE_IDS;
  return list[(Math.random() * list.length) | 0];
}

// My pairing rating: stored profile handicap → computed from rounds → default.
async function resolveMyHandicap() {
  if (!isLoggedIn() || !currentUser()) return QM_DEFAULT_HCP;
  if (_profile && typeof _profile.handicap === "number") return _profile.handicap;
  try {
    const rounds = await fetchRoundsFor(currentUser().id);
    const h = computeMyStats(rounds || []).handicap;
    return typeof h === "number" ? h : QM_DEFAULT_HCP;
  } catch (e) { return QM_DEFAULT_HCP; }
}
// After a logged-in round: recompute + persist handicap so pairing stays fresh.
async function refreshMyHandicap() {
  if (!LB_ON() || !isLoggedIn() || !currentUser()) return;
  try {
    const rounds = await fetchRoundsFor(currentUser().id);
    const h = computeMyStats(rounds || []).handicap;
    if (typeof h !== "number") return;
    await fetch(LB_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(currentUser().id), {
      method: "PATCH", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ handicap: h }),
    });
    if (_profile) _profile.handicap = h;
  } catch (e) { /* best-effort */ }
}

// Flag a finished match 'done' (best-effort) → H2H counts it, queue ignores it.
function markMatchDone() {
  if (cpuMatch || !activeMatch || !activeMatch.id || !LB_ON()) return;
  fetch(LB_URL + "/rest/v1/matches?id=eq." + encodeURIComponent(activeMatch.id), {
    method: "PATCH", headers: authHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ status: "done" }),
  }).catch(() => {});
}

// --- RPC + queue REST ---
async function rpcFindMatch(hcp, format, holes, band, excludeId) {
  if (!LB_ON()) return null;
  try {
    const res = await fetch(LB_URL + "/rest/v1/rpc/find_quick_match", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        p_user: (currentUser() || {}).id || null,
        p_name: getPlayerName() || "Player",
        p_hcp: hcp, p_format: format, p_holes: holes, p_band: band,
        p_exclude: excludeId || null,   // my own queue row → never self-pair (guests)
      }),
    });
    if (!res.ok) return null;
    const out = await res.json();   // scalar uuid or null
    return (out && typeof out === "string") ? out : null;
  } catch (e) { return null; }
}
async function enqueueMe(hcp, format, holes) {
  if (!LB_ON()) return null;
  try {
    const res = await fetch(LB_URL + "/rest/v1/match_queue", {
      method: "POST", headers: authHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        user_id: (currentUser() || {}).id || null,
        player_name: getPlayerName() || "Player",
        handicap: hcp, format, hole_count: holes, status: "waiting",
      }),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ? rows[0].id : null;
  } catch (e) { return null; }
}
async function fetchMyQueueRow(id) {
  if (!LB_ON() || !id) return null;
  try {
    const res = await fetch(LB_URL + "/rest/v1/match_queue?id=eq." + encodeURIComponent(id) + "&limit=1",
                            { headers: lbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch (e) { return null; }
}
async function cancelQueue() {
  const id = _qm && _qm.queueRowId;
  if (!id || !LB_ON()) return;
  try {
    await fetch(LB_URL + "/rest/v1/match_queue?id=eq." + encodeURIComponent(id), {
      method: "PATCH", headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ status: "cancelled" }),
    });
  } catch (e) { /* best-effort */ }
}

// --- Matchmaking loop ---
function runQuickMatch(format, holes) {
  stopQuickMatch();
  _qm = { format, holes, band: 5, startedAt: Date.now(),
          cpuAt: QM_CPU_MIN_MS + Math.random() * (QM_CPU_MAX_MS - QM_CPU_MIN_MS),
          queueRowId: null, paired: false, cancelled: false, timer: null, liveWait: null };
  resolveMyHandicap().then(h => { _qmHcp = h; });
  if (!LB_ON()) {
    // Offline: no queue to poll, but still run a believable search beat.
    _qm.cpuAt = 3000 + Math.random() * 6000;
    _qm.timer = setInterval(() => {
      const q = _qm;
      if (!q || q.cancelled || q.paired) return;
      const elapsed = Date.now() - q.startedAt;
      updateQuickSearchUI(elapsed, qmBandFor(elapsed));
      if (elapsed >= q.cpuAt) { q.paired = true; startCpuMatch(q.format, q.holes); }
    }, QM_POLL_MS);
    return;
  }
  qmTick();
  _qm.timer = setInterval(qmTick, QM_POLL_MS);
}
async function qmTick() {
  const q = _qm;
  if (!q || q.cancelled || q.paired) return;
  const elapsed = Date.now() - q.startedAt;
  q.band = qmBandFor(elapsed);
  updateQuickSearchUI(elapsed, q.band);
  if (elapsed >= q.cpuAt) {             // give up on humans → CPU
    q.paired = true; await cancelQueue(); startCpuMatch(q.format, q.holes); return;
  }
  // Try to grab a waiting opponent (I become the joiner). Exclude my own queue
  // row so a guest (no user_id) can't be paired with itself.
  const id = await rpcFindMatch(_qmHcp, q.format, q.holes, q.band, q.queueRowId);
  if (!_qm || q.cancelled) return;
  if (id) { q.paired = true; await cancelQueue(); joinPairedMatch(id, true); return; }
  // No partner: make sure I'm in the pool, then see if someone picked me.
  if (!q.queueRowId) { q.queueRowId = await enqueueMe(_qmHcp, q.format, q.holes); return; }
  const row = await fetchMyQueueRow(q.queueRowId);
  if (!_qm || q.cancelled) return;
  if (row && row.status === "matched" && row.matched_match_id) {
    q.paired = true; joinPairedMatch(row.matched_match_id, false);
  }
}
async function joinPairedMatch(matchId, iAmJoiner) {
  stopQmTimers();
  const m = await fetchMatchById(matchId);
  if (!m) { startCpuMatch(_qm ? _qm.format : "match", _qm ? _qm.holes : 18); return; }
  activeMatch = m;
  _matchIsHost = !iAmJoiner;
  _matchEntered = false;
  const format = (_qm && _qm.format) || m.format || "match";
  const holes = (_qm && _qm.holes) || m.hole_count || 18;
  if (iAmJoiner) {
    // I created the match via the RPC → set course/settings + flip it live.
    qmMatchFound(m.host_name || "your opponent", null, async () => {
      await beginMatch(qmPickCourse(), holes, gameDefaults, format, format === "match");
      closeQuickMatch();
      enterLiveMatch();
    });
  } else {
    qmMatchFound("your opponent", null, () =>
      waitForLiveThenEnter(matchId, format, holes));   // enter once joiner goes live
  }
}
function waitForLiveThenEnter(matchId, format, holes) {
  let tries = 0;
  stopQmTimers();
  const iv = setInterval(async () => {
    tries++;
    const m = await fetchMatchById(matchId);
    if (m) activeMatch = m;
    if (m && m.status === "live" && m.course_id) {
      clearInterval(iv); closeQuickMatch(); enterLiveMatch(); return;
    }
    if (tries >= QM_LIVE_TRIES) {   // joiner never began → drive it myself
      clearInterval(iv);
      await beginMatch(qmPickCourse(), holes, gameDefaults, format, format === "match");
      closeQuickMatch(); enterLiveMatch();
    }
  }, QM_POLL_MS);
  if (_qm) _qm.liveWait = iv;
}
function stopQmTimers() {
  if (_qm) {
    if (_qm.timer) { clearInterval(_qm.timer); _qm.timer = null; }
    if (_qm.liveWait) { clearInterval(_qm.liveWait); _qm.liveWait = null; }
  }
}
function stopQuickMatch() { if (_qm) { _qm.cancelled = true; stopQmTimers(); } }
async function cancelQuickMatch() {
  await cancelQueue();
  stopQuickMatch();
  _qm = null;
  closeQuickMatch();
}

// --- Local CPU opponent (no DB) ---
function gaussRand() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
// A hole score for a bot of the given handicap: mean = par + hcp/18, jittered,
// clamped to a sane band (eagle floor on par-5s, birdie floor otherwise).
// Legend-tier bots (hcp ≤ -15) get one shot more of headroom so they can
// eagle par-4s — a +22 lives on this floor, birdying nearly every hole.
function cpuHoleScore(par, hcp) {
  const mean = par + (hcp || 0) / 18;
  const s = Math.round(mean + gaussRand() * 1.0);
  const deep = (hcp || 0) <= -15 ? 1 : 0;
  const lo = (par >= 5 ? par - 2 : par - 1) - deep;
  return Math.max(1, Math.min(par + 4, Math.max(lo, s)));
}
// Believable opponent identity (never revealed as a bot). Three name styles —
// plain first names, golfy handles, name+number — mixed so no pattern shows.
const QM_NAMES = ["Mike","Dave","Sarah","Greg","Kevin","Emma","Dan","Josh",
  "Nate","Kyle","Sara","Paulo","Matt","Erik","Jill","Tom","Pete","Andy","Raj",
  "Carlos","Jordan","Justin","Cam","Tommy","Shane","Max","Tony","Marcus",
  "Davis","Taylor","Sam","Chris","Ben","Luke","Brian","Jen","Omar","Lena"];
const QM_HANDLES = ["TeeTimeTom","birdie_hunt3r","FairwayFrank","3PuttTony",
  "shankopotamus","GreensInReg","mulligan_mike","BogeyBill","chip_n_run",
  "DivotDan","sandsave22","LagPutter","draw_bias","pin_seeker9","WeekendWedge",
  "double_cross","toe_hook","up_n_down","short_sided","BreakfastBall"];
function genOppName() {
  const r = Math.random();
  if (r < 0.3) return QM_HANDLES[(Math.random() * QM_HANDLES.length) | 0];
  const n = QM_NAMES[(Math.random() * QM_NAMES.length) | 0];
  if (r < 0.55) return n + String((Math.random() * 90 + 10) | 0);   // name+number
  // plain name, sometimes with a last initial
  return Math.random() < 0.35
    ? n + " " + String.fromCharCode(65 + ((Math.random() * 26) | 0))
    : n;
}
function genOppHandicap(myHcp) {
  const base = (typeof myHcp === "number") ? myHcp : QM_DEFAULT_HCP;
  return Math.round(base + (Math.random() * 6 - 3));   // ±3 of the player
}
// Recompute the bot's running to-par + progress from its filled hole scores.
function cpuRecomputeScore() {
  if (!cpuOpp) return;
  let s = 0, n = 0;
  for (const k in cpuOpp.hole_scores) { s += cpuOpp.hole_scores[k] - (cpuOpp.pars[k] || 0); n++; }
  cpuOpp.score = s; cpuOpp.holes_played = n;
  cpuOpp.finished = n >= roundHoleCount();
}
// Synthesize the two match_players rows for a CPU match from local state.
function cpuMatchRows() {
  const hs = {}, hp = {};
  for (const h of round.holeStats) {
    hs[h.hole] = h.strokes;
    if (h.proximity != null) hp[h.hole] = h.proximity;
  }
  const me = {
    user_id: (currentUser() || {}).id || null,
    player_name: getPlayerName() || "You",
    score: round.score, holes_played: round.holesPlayed,
    finished: round.holesPlayed >= roundHoleCount(),
    hole_scores: hs, hole_prox: hp,
    cur_hole: (typeof HOLE !== "undefined" && HOLE && HOLE.num) || null,
    cur_to_pin: -1, cur_at_rest: true,
  };
  return [me, cpuOpp];
}
// =====================================================================
//  BOT LADDER — 10 fixed opponents, chess.com style. Beat one to unlock
//  the next (match play win only; halve/loss = retry). Fixed handicaps
//  drive the existing cpuPlanHole skill model; per-bot knobs tweak
//  dispersion (latMul), day-form scatter (vol) + offset (bias) and
//  one-putt odds (putt). color = avatar circle. Admins play all.
// =====================================================================
const BOTS = [
  { id: "chip",   name: "Chip Duffington",  ini: "CD", hcp: 26, color: "#7d8a6a",
    desc: "Brand new to the game and thrilled just to make contact.",
    tags: ["Beginner", "Nervy"],              latMul: 1.25, vol: 4.5, bias: 1.5 },
  { id: "sandy",  name: "Sandy Trapworth",  ini: "ST", hcp: 22, color: "#a8894e",
    desc: "Finds every bunker on the course like it owes her money.",
    tags: ["Bunker magnet", "Scrambler"],     latMul: 1.15, vol: 4,   bias: 1 },
  { id: "bo",     name: "Bo Geyman",        ini: "BG", hcp: 18, color: "#8a6d5c",
    desc: "A bogey on every hole, rain or shine — never better, never worse.",
    tags: ["Bogey machine", "Relentless"],    latMul: 1.0,  vol: 2,   bias: 1 },
  { id: "shorty", name: "Shorty Fairlane",  ini: "SF", hcp: 15, color: "#5e7d6b",
    desc: "Never long off the tee, but he has not seen the rough in years.",
    tags: ["Dead straight", "Short hitter"],  latMul: 0.7,  vol: 3,   bias: 1 },
  { id: "boomer", name: "Boomer Slicewell", ini: "BS", hcp: 12, color: "#9a5b45",
    desc: "Swings out of his shoes — the ball goes a mile, usually right.",
    tags: ["Bomber", "Big slice"],            latMul: 1.35, vol: 5,   bias: 1 },
  { id: "faye",   name: "Faye Waymaker",    ini: "FW", hcp: 9,  color: "#4e5d6c",
    desc: "Plots her way around the course like a chess player.",
    tags: ["Course manager", "Steady"],       latMul: 0.9,  vol: 2.5, bias: 0.5 },
  { id: "rusty",  name: "Rusty Blades",     ini: "RB", hcp: 6,  color: "#7a4f63",
    desc: "Birdie or blow-up — he has never heard of laying up.",
    tags: ["Streaky", "Aggressive"],          latMul: 1.1,  vol: 6,   bias: 0.5 },
  { id: "iris",   name: "Iris Sweetspot",   ini: "IS", hcp: 3,  color: "#3f6d5a",
    desc: "Pin-high so often the members stopped applauding.",
    tags: ["Iron precision", "Pin seeker"],   latMul: 0.75, vol: 3,   bias: 0.5 },
  { id: "ace",    name: "Ace Parsons",      ini: "AP", hcp: 0,  color: "#31575f",
    desc: "A scratch machine who has not three-putted since spring.",
    tags: ["Scratch", "Ice cold"],            latMul: 0.85, vol: 2,   bias: 0.5, putt: 0.25 },
  { id: "wren",   name: "Wren Ironwood",    ini: "WI", hcp: -3, color: "#2e4d3a",
    desc: "Tour winner. Does not miss, and the putter is always hot.",
    tags: ["Tour pro", "Hot putter"],         latMul: 0.8,  vol: 2.5, bias: 0, putt: 0.32 },
  // Legend tier — beyond human. Plus-handicaps deep enough that the hole-score
  // model lives on its birdie/eagle floor; each one putts hotter than the last.
  { id: "blaze",  name: "Blaze Calloway",   ini: "BC", hcp: -6, color: "#6d3f2e",
    desc: "Won everything worth winning, then won it all again.",
    tags: ["Legend", "Clutch"],               latMul: 0.7,  vol: 2,   bias: 0, putt: 0.35 },
  { id: "miles",  name: "Miles Farr",       ini: "MF", hcp: -10, color: "#3a4d6d",
    desc: "The longest hitter alive — the fairway simply cannot escape him.",
    tags: ["Machine long", "Flawless"],       latMul: 0.6,  vol: 1.8, bias: 0, putt: 0.38 },
  { id: "domino", name: "Domino Vale",      ini: "DV", hcp: -15, color: "#4d2e4a",
    desc: "Plays the course like it was rigged in her favor.",
    tags: ["Unshakable", "Surgical"],         latMul: 0.55, vol: 1.5, bias: 0, putt: 0.42 },
  { id: "keeper", name: "The Greenskeeper", ini: "GK", hcp: -22, color: "#1d2b20",
    desc: "Knows every blade of grass by name. Nobody has ever beaten him.",
    tags: ["Myth", "Perfect"],                latMul: 0.5,  vol: 1.2, bias: 0, putt: 0.5 },
];
function botById(id) { return BOTS.find(b => b.id === id) || null; }
function botIndex(id) { return BOTS.findIndex(b => b.id === id); }
function botHcpLabel(b) { return b.hcp < 0 ? "+" + (-b.hcp) : String(b.hcp); }
// Ladder progress: {botId: "YYYY-MM-DD"} in localStorage (works for guests).
function getBotsBeaten() { return lsGet("golf.botsBeaten", {}); }
function botBeaten(id) { return !!getBotsBeaten()[id]; }
function markBotBeaten(id) {              // true only on the FIRST win
  const m = getBotsBeaten();
  if (m[id]) return false;
  m[id] = new Date().toISOString().slice(0, 10);
  lsSet("golf.botsBeaten", m);
  return true;
}
function botUnlocked(i) { return isTournamentAdmin() || i === 0 || botBeaten(BOTS[i - 1].id); }
function nextBotAfter(id) { const i = botIndex(id); return i >= 0 ? BOTS[i + 1] || null : null; }

// `bot` (optional) = a BOTS entry: fixed identity + trait knobs instead of the
// random Quick Match opponent. activeMatch._bot marks a ladder match — the
// random CPU fallback never sets it, so it can never advance the ladder.
function startCpuMatch(format, holes, bot) {
  stopQuickMatch();
  _qm = null;
  track("match_start", { kind: bot ? "bot" : "cpu", format, holes, bot: bot ? bot.id : null });
  const isMatch = format === "match";
  cpuMatch = true; matchDecided = false; _matchEntered = false;
  matchHoleCount = holes;
  // Ladder matches honor the player's course pick; random otherwise.
  selectedCourseId = (bot && botCourseId) ? botCourseId : qmPickCourse();
  const myH = (typeof _qmHcp === "number") ? _qmHcp : QM_DEFAULT_HCP;
  const oppH = bot ? bot.hcp : genOppHandicap(myH);
  const name = bot ? bot.name : genOppName();
  // Day form: a real round scatters around the handicap (usually a bit above
  // it — handicap is potential, not average). Rolled once per match so the
  // bot can have a career day or a blow-up round, not always shoot its number.
  // Ladder bots roll with their own consistency (vol) and offset (bias).
  const dayH = bot
    ? Math.max(oppH - 3, oppH + (bot.bias ?? 1) + gaussRand() * (bot.vol ?? 4))  // floor tracks the bot (legend tier goes past -5)
    : Math.max(-4, oppH + 1 + gaussRand() * 4);
  cpuOpp = {
    user_id: null, player_name: name, handicap: oppH, _dayHcp: dayH,
    hole_scores: {}, pars: {}, score: 0, holes_played: 0, finished: false,
    cur_hole: null, cur_strokes: 0, cur_to_pin: -1, cur_at_rest: true,
    cur_x: null, cur_y: null, cur_shot: null, cur_updated: null,
    _plan: null, _i: 0, _phase: "idle", _flyUntil: 0, _nextAt: 0, _seq: 0,
  };
  if (bot) { cpuOpp._latMul = bot.latMul; cpuOpp._onePuttP = bot.putt; }
  activeMatch = {
    id: null, status: "live", format: isMatch ? "match" : "stroke",
    live: true,                          // bot plays live shot-by-shot in both formats
    hole_count: holes, course_id: selectedCourseId,
    // Coin-flip hole-1 honors — a real pairing has no fixed teeing order.
    host_name: Math.random() < 0.5 ? (getPlayerName() || "You") : name,
    settings: normalizeSettings(gameDefaults), _cpu: true,
  };
  if (bot) activeMatch._bot = bot.id;
  // Live-runtime init (mirrors enterLiveMatch); no realtime — there's no DB row.
  lastOpp = cpuOpp; lastMe = null; oppShot = null; _shotFrom = null;
  _lastOppSeq = -1; _matchSeq = 0; _spectating = false; _awaitLive = null;
  _oppUpdatedSeen = null; _oppFreshAt = performance.now(); _liveStartAt = performance.now();
  const enter = () => {
    closeQuickMatch();
    if (typeof closeBotSelect === "function") closeBotSelect();
    closeMatchResults();
    startCourse();
    startBoardPoll();
    autoShowMatchBoard();
  };
  // Ladder: the player picked the opponent — skip the fake "Match found" beat.
  if (bot) enter();
  else qmMatchFound(name, null, enter, true);   // QM fallback: an honest CPU beat
}

// "Match found" beat in the searching overlay before dropping into the round.
// A CPU fallback looks different from a live pairing — no pretending.
function qmMatchFound(name, hcp, then, isCpu) {
  const ov = document.getElementById("quick-match");
  const spin = ov && ov.querySelector(".qm-spinner");
  const hint = ov && ov.querySelector(".qm-hint");
  const s = document.getElementById("qm-search-status");
  if (spin) spin.style.display = "none";
  if (hint) hint.style.display = "none";
  if (s) {
    if (isCpu) {
      s.innerHTML = 'No live player right now — <b>' + esc(name) +
                    '</b> steps in <span class="cpu-chip">CPU</span>';
    } else {
      s.innerHTML = '<span class="qm-live-dot" aria-hidden="true"></span>Match found — <b>' +
                    esc(name) + '</b>' + (typeof hcp === "number" ? " · hcp " + hcp : "");
    }
  }
  setTimeout(then, 900 + Math.random() * 1300);
}

// =====================================================================
//  Live CPU driver — makes the bot play the hole shot-by-shot so it shows up
//  exactly like a real live opponent (gold ghost ball + arc tweens + turn
//  order + follow-cam), all via the existing cur_* fields on cpuOpp. Called
//  every frame from loop() while a live CPU match is on the course.
// =====================================================================
// Bot's lie label at a point, matching the human lieLabel() vocabulary.
function cpuLie(x, y) { return LIE_NAMES[surfaceAt(x, y)] || "Rough"; }
// Green polygon containing the pin (null on fallback holes with no green poly).
function cpuGreenPoly() {
  const gs = (HOLE.surfaces && HOLE.surfaces.green) || [];
  for (const p of gs) if (pointInPoly(HOLE.holePos.x, HOLE.holePos.y, p)) return p;
  return gs[0] || null;
}
// A point ON the green within ~rFt feet of the pin (rejection-sampled).
function cpuPointNearPin(rFt) {
  const pin = HOLE.holePos, g = cpuGreenPoly();
  const rU = rFt / (YARDS_PER_UNIT * 3);           // feet → world units
  for (let t = 0; t < 25; t++) {
    const a = Math.random() * Math.PI * 2;
    const d = rU * (0.3 + Math.random() * 0.7);
    const x = pin.x + Math.cos(a) * d, y = pin.y + Math.sin(a) * d;
    if (g ? pointInPoly(x, y, g) : dist(x, y, pin.x, pin.y) <= rU) return { x, y };
  }
  return { x: pin.x + (Math.random() - 0.5) * rU * 0.4,
           y: pin.y + (Math.random() - 0.5) * rU * 0.4 };
}
// Keep a landing point out of water/OB/trees: try lateral nudges off the shot
// line, then shorter carries; the score is predetermined, so a hazard would
// desync the stroke count from the story the ghost ball tells.
function cpuSafePoint(pt, from) {
  const bad = s => s === "water" || s === "ob" || s === "woods";
  if (!bad(surfaceAt(pt.x, pt.y))) return pt;
  const dx = pt.x - from.x, dy = pt.y - from.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  for (const o of [2, -2, 4, -4, 7, -7, 10, -10, 14, -14]) {
    const q = { x: pt.x + nx * o, y: pt.y + ny * o };
    if (!bad(surfaceAt(q.x, q.y))) return q;
  }
  for (const f of [0.92, 0.85, 0.7]) {
    const q = { x: from.x + dx * f, y: from.y + dy * f };
    if (!bad(surfaceAt(q.x, q.y))) return q;
  }
  return { x: (from.x + HOLE.holePos.x) / 2, y: (from.y + HOLE.holePos.y) / 2 };
}
// A hazard point a blown shot from `from` could actually find: scan growing
// lateral offsets both sides of the pin line (plus short/long variance) for
// water/OB/trees. Null when the hole has no trouble in range — then the
// mistake falls back to a duff instead.
function cpuHazardPoint(from, carryU) {
  const pin = HOLE.holePos;
  const remainU = dist(from.x, from.y, pin.x, pin.y) || 0.001;
  const ux = (pin.x - from.x) / remainU, uy = (pin.y - from.y) / remainU;
  const bad = s => s === "water" || s === "ob" || s === "woods";
  const side = Math.random() < 0.5 ? 1 : -1;
  for (const sgn of [side, -side]) {
    for (let lat = 0; lat <= 20; lat += 3) {
      const fwd = carryU * (0.55 + Math.random() * 0.45);
      const x = from.x + ux * fwd - uy * lat * sgn;
      const y = from.y + uy * fwd + ux * lat * sgn;
      if (bad(surfaceAt(x, y))) return { x, y };
    }
  }
  return null;
}
// Human-feeling pause before a shot: 1-4s, leaning longer sometimes on the
// tee or on green reads — never metronome-regular.
// Bot pace: CPU opponents aren't humans — no reason to wait on them like one.
// Scales BOTH think time and shot-flight time; lower = snappier. Applies to every
// CPU match (ladder + Quick Match fallback).
const CPU_PACE = 0.4;   // ~2.5x faster than the old human-like cadence

function cpuThinkMs(kind, firstOfHole) {
  let ms = 1000 + Math.random() * 2200;
  if (firstOfHole && Math.random() < 0.5) ms += Math.random() * 800;
  if (kind === "putt" && Math.random() < 0.25) ms += Math.random() * 800;
  return Math.max(250, Math.min(ms, 4000) * CPU_PACE);
}
// Plan the current hole as real golf played from the SAME club bag the human
// gets (TUNE.clubs + clubForYards auto-selection): driver off the tee, layups
// that leave a comfortable wedge, an approach that lands on the green, then
// 1-3 putts. Handicap scales carry efficiency; extra strokes over a clean
// route show up as visible mistakes (duffs / offline).
function cpuPlanHole() {
  if (!cpuOpp || !HOLE) return;
  // Score off the rolled day form, not the raw handicap — see startCpuMatch.
  const hcp = (typeof cpuOpp._dayHcp === "number") ? cpuOpp._dayHcp : (cpuOpp.handicap || 0);
  const total = cpuHoleScore(HOLE.par, hcp);
  const tee = HOLE.teePos, pin = HOLE.holePos;
  const holeYds = dist(tee.x, tee.y, pin.x, pin.y) * YARDS_PER_UNIT;
  // Skill = fraction of a club's rated carry this bot actually gets (hcp 0 →
  // full number, hcp 18 → ~88%), with a small per-shot jitter.
  const eff = Math.max(0.75, Math.min(1.02, 1 - hcp * 0.007));
  cpuOpp._eff = eff;                       // ghost arc height uses it too
  const carryOf = k => TUNE.clubs[k].carry * eff * (1 + gaussRand() * 0.04);
  const drvC = TUNE.clubs.driver.carry * eff;
  const latFrac = Math.max(0.004, 0.035 + hcp * 0.0022) * (cpuOpp._latMul || 1);   // dispersion as a fraction of carry (floored — legend hcp would go negative)
  const pts = [];
  if (total === 1) {
    pts.push({ x: pin.x, y: pin.y, kind: "long", club: clubForYards(holeYds) });
  } else {
    // Putts: 1 (20%, hot-putter bots more) / 2 (usual) / 3 (only when over par).
    let P = Math.random() < (cpuOpp._onePuttP || 0.2) ? 1
          : (total > HOLE.par && Math.random() < 0.31 ? 3 : 2);
    P = Math.max(1, Math.min(P, total - 1));
    const neededClean = Math.max(1, Math.ceil(Math.max(0, holeYds - 15) / drvC));
    while (total - P < neededClean && P > 1) P--;   // don't demand impossible carries
    const L = total - P;
    let extra = Math.max(0, L - neededClean);       // strokes to burn as mistakes
    let cur = tee, left = L;
    while (left > 0) {
      const atTee = cur === tee;
      const remainU = dist(cur.x, cur.y, pin.x, pin.y) || 0.001;
      const remainYds = remainU * YARDS_PER_UNIT;
      // Blow-up strokes come from penalties, not duff chains: a blown shot
      // finds water/OB/trees → stroke + penalty, replay from the same spot
      // (stroke-and-distance, 2 strokes, no progress). Only when the strokes
      // left after the penalty still cover the hole, and only on holes that
      // actually have trouble in range.
      const needAfterOB = Math.max(1, Math.ceil(Math.max(0, remainYds - 15) / drvC));
      if (extra >= 2 && left - 2 >= needAfterOB && Math.random() < 0.65) {
        const hz = cpuHazardPoint(cur, Math.min(drvC, remainYds + 15) / YARDS_PER_UNIT);
        if (hz) {
          hz.kind = "long"; hz.penalty = true;
          hz.club = atTee ? "driver" : clubForYards(Math.min(remainYds, drvC));
          pts.push(hz);
          extra -= 2; left -= 2;
          continue;                       // cur unchanged → replay from here
        }
      }
      let pt;
      if (left === 1) {
        // Approach → on the green; proximity worsens with distance + handicap.
        let proxFt = Math.max(2, Math.min(45, 6 + remainYds * 0.11 + hcp * 0.7 + gaussRand() * 7));
        if (P === 1) proxFt = Math.min(proxFt, 12);
        if (P === 3) proxFt = Math.max(proxFt, 25);
        pt = cpuPointNearPin(proxFt);
        pt.club = clubForYards(remainYds);
      } else {
        // Auto-club thinking: too far to reach → longest club, max carry
        // (driver only off the tee) — humans play aggressive, they don't
        // throttle a long club. Reachable but more field legs to come →
        // usually still go for it (mishit short burns the leg); a genuine
        // wedge-range layup is the rare choice, and only from real layup
        // distance — a human never "lays up" a par-3 tee shot.
        const longest = atTee ? "driver" : "3w";
        let club = longest, carryYds = carryOf(longest);
        if (remainYds <= carryYds + 20) {
          if (!atTee && remainYds >= 200 && Math.random() < 0.2) {
            const leave = 80 + Math.random() * 30;
            club = clubForYards(remainYds - leave);
            carryYds = Math.min(carryOf(club), remainYds - 30);
          } else {
            club = clubForYards(remainYds);
            carryYds = Math.min(carryOf(club), remainYds) * (0.65 + Math.random() * 0.3);
          }
        }
        const legsLeft = left - 1;   // field legs after this one (incl. the approach)
        // Feasibility: the remaining legs must still be able to cover the hole.
        carryYds = Math.max(carryYds, remainYds - drvC * legsLeft, 15);
        let latMult = 1;
        if (extra > 0 && (Math.random() < 0.5 || extra >= left - 1)) {
          extra--;
          if (Math.random() < 0.5) carryYds *= 0.35 + Math.random() * 0.2; // duff
          else latMult = 2.5;                                              // offline
        }
        const carryU = carryYds / YARDS_PER_UNIT;
        const ux = (pin.x - cur.x) / remainU, uy = (pin.y - cur.y) / remainU;
        const lat = gaussRand() * carryU * latFrac * latMult;
        const fwd = carryU * (1 + (Math.random() * 0.06 - 0.03));
        pt = cpuSafePoint({ x: cur.x + ux * fwd - uy * lat,
                            y: cur.y + uy * fwd + ux * lat }, cur);
        pt.club = club;
      }
      pt.kind = "long";
      pts.push(pt); cur = pt; left--;
    }
    if (P === 1) {
      pts.push({ x: pin.x, y: pin.y, kind: "putt", club: "putter" });
    } else if (P === 2) {
      const lag = cpuPointNearPin(1.5 + Math.abs(gaussRand()) * 2.5);
      pts.push({ x: lag.x, y: lag.y, kind: "putt", club: "putter" },
               { x: pin.x, y: pin.y, kind: "putt", club: "putter" });
    } else {
      const p1 = cpuPointNearPin(8 + Math.abs(gaussRand()) * 3);
      const p2 = cpuPointNearPin(1 + Math.random() * 1.5);
      pts.push({ x: p1.x, y: p1.y, kind: "putt", club: "putter" },
               { x: p2.x, y: p2.y, kind: "putt", club: "putter" },
               { x: pin.x, y: pin.y, kind: "putt", club: "putter" });
    }
  }
  cpuOpp._plan = pts; cpuOpp._i = 0; cpuOpp._phase = "idle";
  cpuOpp.cur_hole = HOLE.num; cpuOpp.cur_strokes = 0;
  cpuOpp.cur_x = tee.x; cpuOpp.cur_y = tee.y;
  cpuOpp.cur_to_pin = Math.round(dist(tee.x, tee.y, pin.x, pin.y) * YARDS_PER_UNIT);
  cpuOpp.cur_at_rest = true; cpuOpp.cur_shot = null; cpuOpp.cur_lie = "Tee";
  cpuOpp._planPin = { x: pin.x, y: pin.y };   // replan key: hole num alone can collide across courses
  cpuOpp._nextAt = performance.now() + cpuThinkMs(pts[0].kind, true);
}
function cpuDriverTick() {
  if (!cpuMatch || !liveMatch() || mode !== "course" || holeTransition) return;
  if (!cpuOpp || !HOLE || HOLE.isRange) return;
  const now = performance.now();
  lastOpp = cpuOpp; _oppFreshAt = now;   // bot is always "responsive" → turn-gate honored
  if (cpuOpp.cur_hole !== HOLE.num || !cpuOpp._planPin ||
      cpuOpp._planPin.x !== HOLE.holePos.x || cpuOpp._planPin.y !== HOLE.holePos.y) cpuPlanHole();
  checkHoleConcede();                     // bot already in with a score I can't match? pick up
  pumpLiveAdvance();                      // snappy hole-advance once the bot holes out

  // Resolve an in-flight bot shot → land the ball.
  if (cpuOpp._phase === "flying") {
    if (now < cpuOpp._flyUntil) return;
    const target = cpuOpp._plan[cpuOpp._i];
    if (target.penalty) {
      // Ball found water/OB: stroke + penalty, replay from where he played
      // (stroke-and-distance) — cur_x/cur_y stay put.
      cpuOpp.cur_strokes += 2;
    } else {
      cpuOpp.cur_x = target.x; cpuOpp.cur_y = target.y;
      cpuOpp.cur_strokes++;
    }
    cpuOpp.cur_at_rest = true;
    cpuOpp.cur_updated = new Date().toISOString();
    const holed = !target.penalty && cpuOpp._i >= cpuOpp._plan.length - 1;
    cpuOpp._i++;
    if (holed) {
      cpuOpp.cur_to_pin = -1;
      cpuOpp.hole_scores[HOLE.num] = cpuOpp.cur_strokes;
      cpuOpp.pars[HOLE.num] = HOLE.par;
      cpuRecomputeScore();
      checkMatchCloseout();
    } else {
      cpuOpp.cur_to_pin = Math.round(dist(cpuOpp.cur_x, cpuOpp.cur_y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT);
      cpuOpp.cur_lie = cpuLie(cpuOpp.cur_x, cpuOpp.cur_y);
    }
    cpuOpp._phase = "idle";
    const next = cpuOpp._plan[cpuOpp._i];
    cpuOpp._nextAt = now + cpuThinkMs(next ? next.kind : "long", false);
    return;
  }

  // Idle: fire the next shot only when it's the bot's turn (away/honors).
  if ((cpuOpp.cur_to_pin | 0) < 0) return;   // already holed this hole
  if (now < cpuOpp._nextAt) return;
  const t = liveTurnHolder(meSnapshot(), cpuOpp);
  if (!t || !sameName(t, cpuOpp.player_name)) return;   // not the bot's turn
  const from = { x: cpuOpp.cur_x, y: cpuOpp.cur_y };
  const target = cpuOpp._plan[cpuOpp._i];
  if (!target) return;
  const d = dist(from.x, from.y, target.x, target.y);
  const dYds = d * YARDS_PER_UNIT;
  // Putts roll slow and flat; full shots hang in the air like a real swing.
  // Scaled by CPU_PACE so the bot's ball also travels faster (still readable).
  const durMs = target.kind === "putt"
    ? Math.max(350, Math.min(2600, 900 + dYds * 3 * 45) * CPU_PACE)
    : Math.max(300, Math.min(3400, dYds * 10 * (0.9 + Math.random() * 0.25)) * CPU_PACE);
  const lie = cpuOpp.cur_strokes === 0 ? "Tee" : cpuLie(from.x, from.y);
  // Arc apex from the club's rated max height (like the human flight model);
  // partial shots (duffs, layup clamps) arc proportionally lower.
  const club = target.club && TUNE.clubs[target.club];
  const peak = target.kind === "putt" ? 0
    : club ? (club.maxH / YARDS_PER_UNIT) *
             Math.min(1, dYds / Math.max(1, club.carry * (cpuOpp._eff || 1)))
    : d * 0.16;
  cpuOpp._seq++;
  cpuOpp.cur_shot = { seq: cpuOpp._seq, hole: HOLE.num,
    fromX: from.x, fromY: from.y, toX: target.x, toY: target.y,
    peak, durMs: Math.round(durMs), lie };
  cpuOpp.cur_at_rest = false;
  cpuOpp.cur_updated = new Date().toISOString();
  startOppGhost(cpuOpp);                   // launch the arc tween on my screen
  cpuOpp._phase = "flying";
  cpuOpp._flyUntil = now + durMs;
}

// --- Quick Match overlay UI ---
function openQuickMatch() {
  const ov = document.getElementById("quick-match");
  if (!ov) return;
  ov.dataset.holes = ov.dataset.holes || "18";
  ov.dataset.format = ov.dataset.format || "match";
  syncQuickToggles();
  document.getElementById("qm-setup").classList.remove("hidden");
  document.getElementById("qm-searching").classList.add("hidden");
  ov.classList.remove("hidden");
}
function closeQuickMatch() {
  const ov = document.getElementById("quick-match");
  if (ov) ov.classList.add("hidden");
}
function syncQuickToggles() {
  const ov = document.getElementById("quick-match");
  if (!ov) return;
  ov.querySelectorAll(".qm-len").forEach(b => b.classList.toggle("active", b.dataset.holes === ov.dataset.holes));
  ov.querySelectorAll(".qm-fmt").forEach(b => b.classList.toggle("active", b.dataset.format === ov.dataset.format));
}
function updateQuickSearchUI(elapsed, band) {
  const s = document.getElementById("qm-search-status");
  if (!s) return;
  const secs = Math.floor(elapsed / 1000);
  const bandTxt = band >= 999 ? "any handicap" : "±" + band + " hcp";
  s.textContent = "Searching (" + bandTxt + ") · " + secs + "s";
}
function quickFind() {
  const ov = document.getElementById("quick-match");
  const holes = parseInt(ov.dataset.holes, 10) || 18;
  const format = ov.dataset.format === "stroke" ? "stroke" : "match";
  ensureNameThen(() => {
    document.getElementById("qm-setup").classList.add("hidden");
    document.getElementById("qm-searching").classList.remove("hidden");
    const sp = ov.querySelector(".qm-spinner"), hint = ov.querySelector(".qm-hint");
    if (sp) sp.style.display = "";       // restore (qmMatchFound hides them)
    if (hint) hint.style.display = "";
    updateQuickSearchUI(0, 5);
    runQuickMatch(format, holes);
  });
}

(function wireQuickMatch() {
  const open = document.getElementById("open-quickmatch");
  if (open) open.addEventListener("click", () => ensureNameThen(openQuickMatch));
  const ov = document.getElementById("quick-match");
  if (!ov) return;
  ov.querySelectorAll(".qm-len").forEach(b => b.addEventListener("click", () => {
    ov.dataset.holes = b.dataset.holes; syncQuickToggles();
  }));
  ov.querySelectorAll(".qm-fmt").forEach(b => b.addEventListener("click", () => {
    ov.dataset.format = b.dataset.format; syncQuickToggles();
  }));
  const find = document.getElementById("qm-find");
  if (find) find.addEventListener("click", quickFind);
  const cancel = document.getElementById("qm-cancel");
  if (cancel) cancel.addEventListener("click", () => { cancelQuickMatch(); openPlayMenu(); });
  const close = document.getElementById("qm-close");   // setup "Back" → the Play picker
  if (close) close.addEventListener("click", () => { cancelQuickMatch(); openPlayMenu(); });
})();

// --- Bot ladder picker ---
// Bot-match course choice: null = random (default); an id = play that course.
// Sticky for the session so Rematch / Next bot keep the player's pick.
let botCourseId = null;
let botCoursePickMode = false;   // course picker is open to choose for a bot match

function syncBotCourseRow() {
  const rnd = document.getElementById("bot-course-random");
  const pick = document.getElementById("bot-course-pick");
  if (!rnd || !pick) return;
  rnd.classList.toggle("active", !botCourseId);
  pick.classList.toggle("active", !!botCourseId);
  const c = botCourseId && (COURSES.find(x => x.id === botCourseId) ||
                            FALLBACK_COURSES.find(x => x.id === botCourseId));
  pick.textContent = c ? c.name : "Choose course…";
}

function openBotSelect() {
  closeQuickMatch();
  const ov = document.getElementById("bot-select");
  if (!ov) return;
  ov.dataset.holes = ov.dataset.holes || "9";
  syncBotToggles();
  syncBotCourseRow();
  renderBotList();
  ov.classList.remove("hidden");
}
function closeBotSelect() {
  const ov = document.getElementById("bot-select");
  if (ov) ov.classList.add("hidden");
}
function syncBotToggles() {
  const ov = document.getElementById("bot-select");
  if (!ov) return;
  ov.querySelectorAll(".bot-len").forEach(b => b.classList.toggle("active", b.dataset.holes === ov.dataset.holes));
}
function renderBotList() {
  const list = document.getElementById("bot-list");
  if (!list) return;
  const admin = isTournamentAdmin();
  const note = document.getElementById("bot-admin-note");
  if (note) note.classList.toggle("hidden", !admin);
  list.innerHTML = BOTS.map((b, i) => {
    const open = botUnlocked(i), beat = botBeaten(b.id);
    const state = open
      ? '<button class="menu-btn menu-btn-play bot-play" data-bot="' + b.id + '">Play</button>'
      : '<span class="bot-lock"><span class="ic ic-lock"></span></span>';
    return '<div class="bot-row ' + (open ? (beat ? "bot-beaten" : "bot-open") : "bot-locked") + '">' +
      '<span class="bot-av" style="--bav:' + b.color + '">' + b.ini + '</span>' +
      '<span class="bot-info">' +
        '<span class="bot-name">' + esc(b.name) +
          (beat ? ' <span class="ic ic-check bot-check"></span>' : "") +
          ' <span class="bot-hcp">' + botHcpLabel(b) + ' hcp</span></span>' +
        '<span class="bot-desc">' + (open ? esc(b.desc) : "Beat " + esc(BOTS[i - 1].name) + " to unlock") + '</span>' +
        (open ? '<span class="bot-tags">' + b.tags.map(t => "<i>" + esc(t) + "</i>").join("") + '</span>' : "") +
      '</span>' + state + '</div>';
  }).join("");
}
(function wireBots() {
  const ov = document.getElementById("bot-select");
  if (!ov) return;
  ov.querySelectorAll(".bot-len").forEach(b => b.addEventListener("click", () => {
    ov.dataset.holes = b.dataset.holes; syncBotToggles();
  }));
  const back = document.getElementById("bot-back");
  if (back) back.addEventListener("click", () => { closeBotSelect(); openPlayMenu(); });
  const crnd = document.getElementById("bot-course-random");
  if (crnd) crnd.addEventListener("click", () => { botCourseId = null; syncBotCourseRow(); });
  const cpick = document.getElementById("bot-course-pick");
  if (cpick) cpick.addEventListener("click", () => {
    botCoursePickMode = true;
    closeBotSelect();
    showCourseSelect();
  });
  const list = document.getElementById("bot-list");
  if (list) list.addEventListener("click", (e) => {   // delegated — rows re-render
    const p = e.target.closest(".bot-play");
    if (!p) return;
    const bot = botById(p.dataset.bot);
    if (bot && botUnlocked(botIndex(bot.id))) {
      startCpuMatch("match", parseInt(ov.dataset.holes, 10) || 9, bot);
    }
  });
})();

// =====================================================================
//  Trophy Room — progress overview: courses, ladder, achievements, daily.
// =====================================================================
const PROGRESS_MILESTONES = [
  { id: "first-birdie", label: "First birdie",      hint: "Finish a hole one under par" },
  { id: "first-eagle",  label: "First eagle",       hint: "Finish a hole two under par" },
  { id: "first-ace",    label: "Hole-in-one",       hint: "Ace any hole" },
  { id: "break-par",    label: "Break par",         hint: "Finish an 18-hole round under par" },
  { id: "match-win",    label: "Match winner",      hint: "Win a quick match" },
];
function renderProgress() {
  const body = document.getElementById("pr-body");
  if (!body) return;
  const uc = courseUnlockCount();
  const beaten = Object.keys(getBotsBeaten()).filter((id) => botById(id)).length;
  const nextBot = BOTS.find((b) => !botBeaten(b.id));
  let nextTierN = 0;
  if (nextBot) {
    const t = botIndex(nextBot.id);
    courseTierMap().forEach((v) => { if (v === t) nextTierN++; });
  }
  const ms = getMilestones();
  const fid = dailyFeaturedCourseId();
  const feat = fid && COURSES.find((c) => c.id === fid);
  const st = getDaily();
  const pct = uc.total ? Math.round(100 * uc.unlocked / uc.total) : 0;
  // Reverse index: which course each milestone unlocks (for the hint line).
  const msCourse = {};
  for (const cid in ACHIEVEMENT_COURSES) {
    const c = COURSES.find((x) => x.id === cid);
    msCourse[ACHIEVEMENT_COURSES[cid].milestone] = c ? c.name : cid;
  }
  let html = `<div class="pr-section"><div class="pr-title">Courses</div>` +
    `<div class="pr-row"><span>${uc.unlocked} / ${uc.total} unlocked</span></div>` +
    `<div class="pr-bar"><div class="pr-bar-fill" style="width:${pct}%"></div></div>` +
    (feat ? `<div class="pr-row pr-dim"><span>Free today: ${esc(feat.name)}</span></div>` : "") +
    `</div>`;
  html += `<div class="pr-section"><div class="pr-title">Bot ladder</div>` +
    `<div class="pr-row"><span>${beaten} / ${BOTS.length} bots beaten</span></div>` +
    (nextBot
      ? `<div class="pr-row pr-dim"><span>Next: beat ${esc(nextBot.name)}` +
        (nextTierN ? ` — unlocks ${nextTierN} course${nextTierN === 1 ? "" : "s"}` : "") + `</span></div>`
      : `<div class="pr-row pr-dim"><span>Ladder complete</span></div>`) +
    `</div>`;
  html += `<div class="pr-section"><div class="pr-title">Achievements</div>` +
    PROGRESS_MILESTONES.map((m) => {
      const earned = ms[m.id];
      const unlockNote = msCourse[m.id] ? ` · unlocks ${esc(msCourse[m.id])}` : "";
      return `<div class="pr-row ${earned ? "pr-earned" : "pr-locked"}">` +
        `<span class="ic ${earned ? "ic-check" : "ic-lock"}"></span>` +
        `<span class="pr-ms"><b>${m.label}</b><i>${earned ? "Earned " + earned : m.hint + unlockNote}</i></span>` +
        `</div>`;
    }).join("") + `</div>`;
  html += `<div class="pr-section"><div class="pr-title">Daily challenge</div>` +
    `<div class="pr-row"><span>` +
    ((st.streak || 0) > 0
      ? `Streak: ${st.streak}` + (st.lastDate !== todayStr() ? " · play today to keep it" : "")
      : "No streak yet — play today's daily") +
    `</span></div></div>`;
  body.innerHTML = html;
}
(function wireProgress() {
  const open = document.getElementById("open-progress");
  const ov = document.getElementById("progress");
  const close = document.getElementById("pr-close");
  if (!open || !ov) return;
  open.addEventListener("click", () => { renderProgress(); ov.classList.remove("hidden"); });
  if (close) close.addEventListener("click", () => ov.classList.add("hidden"));
})();

// --- Wire-up ---
(function wireMatch() {
  const open = document.getElementById("open-match");
  if (open) open.addEventListener("click", () => openMatchMenu());

  const mmClose = document.getElementById("mm-close");
  if (mmClose) mmClose.addEventListener("click", closeMatchMenu);
  const mmStart = document.getElementById("mm-start");
  if (mmStart) mmStart.addEventListener("click", () => ensureNameThen(hostStartMatch));
  const mmJoin = document.getElementById("mm-join");
  if (mmJoin) mmJoin.addEventListener("click", () => ensureNameThen(joinMatchFlow));
  const mmCode = document.getElementById("mm-code");
  if (mmCode) mmCode.addEventListener("keydown", (e) => { if (e.key === "Enter") ensureNameThen(joinMatchFlow); });

  const mlBegin = document.getElementById("ml-begin");
  if (mlBegin) mlBegin.addEventListener("click", hostBeginPickCourse);
  const mlLeave = document.getElementById("ml-leave");
  if (mlLeave) mlLeave.addEventListener("click", () => { leaveMatch(); closeMatchLobby(); showMenu(); });
  const mlCopy = document.getElementById("ml-copy");
  if (mlCopy) mlCopy.addEventListener("click", () => {
    const code = activeMatch ? activeMatch.code : "";
    if (!code) return;
    const done = () => {
      mlCopy.textContent = "Copied!";
      mlCopy.classList.add("copied");
      showToast("Code copied", 1400);
      setTimeout(() => { mlCopy.textContent = "Copy"; mlCopy.classList.remove("copied"); }, 1600);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(done).catch(done);
    else done();
  });
  const mlShare = document.getElementById("ml-share");
  if (mlShare) mlShare.addEventListener("click", async () => {
    const code = activeMatch ? activeMatch.code : "";
    if (!code) return;
    const url = matchInviteUrl(code);
    const text = "Join my match on YoGolf — code " + code;
    const done = () => showToast("Invite link copied", 1600);
    try {
      if (navigator.share) { await navigator.share({ text, url }); return; }
    } catch (e) { return; }   // user cancelled the share sheet — not an error
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done).catch(done);
    else done();
  });

  const ms = document.getElementById("match-setup");
  if (ms) ms.querySelectorAll(".ms-len").forEach(b => b.addEventListener("click", () => {
    ms.dataset.holes = b.dataset.holes; syncMatchLengthButtons();
  }));
  if (ms) ms.querySelectorAll(".ms-fmt").forEach(b => b.addEventListener("click", () => {
    if (b.disabled) return;
    ms.dataset.format = b.dataset.format; syncMatchFormatButtons(); syncMatchLiveButton();
  }));
  const msLive = document.getElementById("ms-live");
  if (msLive) msLive.addEventListener("click", () => {
    if (ms.dataset.format !== "match") return;   // match-play only
    ms.dataset.live = ms.dataset.live === "1" ? "0" : "1";
    syncMatchLiveButton();
  });
  const msConfirm = document.getElementById("ms-confirm");
  if (msConfirm) msConfirm.addEventListener("click", confirmMatchSetup);
  const msBack = document.getElementById("ms-back");
  if (msBack) msBack.addEventListener("click", () => { matchSetupMode = false; closeMatchSetup(); openMatchLobby(); });

  const mbClose = document.getElementById("mb-close");
  if (mbClose) mbClose.addEventListener("click", () => toggleMatchBoard(false));
  const hmMatch = document.getElementById("hm-match");
  if (hmMatch) hmMatch.addEventListener("click", () => { toggleMatchBoard(); closeHud(); });
  const hmForfeit = document.getElementById("hm-forfeit");
  if (hmForfeit) hmForfeit.addEventListener("click", () => { forfeitHole(); closeHud(); });
  const reConfirm = document.getElementById("re-confirm-match");
  if (reConfirm) reConfirm.addEventListener("click", openMatchResults);
  const mrHome = document.getElementById("mr-home");
  if (mrHome) mrHome.addEventListener("click", () => {
    leaveMatch();
    mode = "menu";
    elMenu.classList.remove("hidden");
    elHudBtn.classList.add("hidden");
    elHmClubRow.classList.add("hidden");
    closeHud();
    elScorecard.style.display = "none";
  });
  // Ladder: read _bot BEFORE leaveMatch (it nulls activeMatch). Human rematch
  // (renderMatchResults tags the button data-human="1") takes the other path.
  const mrRematch = document.getElementById("mr-rematch");
  if (mrRematch) mrRematch.addEventListener("click", () => {
    if (mrRematch.dataset.human) rematchHumanMatch();
    else startBotFromResults(botById(activeMatch && activeMatch._bot));
  });
  const mrNextBot = document.getElementById("mr-next-bot");
  if (mrNextBot) mrNextBot.addEventListener("click", () => {
    startBotFromResults(nextBotAfter(activeMatch && activeMatch._bot));
  });

  const msResync = document.getElementById("mb-resync");
  if (msResync) msResync.addEventListener("click", () => liveResync());

  // Reconnect/return-to-foreground: phones throttle timers + halt rAF when the tab
  // is hidden, so on return we force an immediate resync and re-broadcast my state
  // (and don't let myself be flagged idle on the first frame back).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) liveResync();
  });
  window.addEventListener("online", () => liveResync());
})();

// Force a full live-match resync: refetch the board now and re-push my state so
// the opponent's view of me corrects immediately. Safe to call any time.
function liveResync() {
  if (!liveMatch()) return;
  _liveStartAt = performance.now();   // restart the startup grace so I'm not instantly "idle"
  reassertMyState(true);
  renderMatchBoard();
}

// =====================================================================
//  Admin tournament management screen (list + per-tournament detail).
//  Gated by isTournamentAdmin(); all writes go through the admin REST
//  helpers + RLS. Reuses computeWindows/SETTING_DEFS/computeCut/entryKey.
// =====================================================================
let _manageCondDraft = null;   // settings draft while editing a tournament's conditions

function closeTournamentManage() {
  document.getElementById("tournament-admin").classList.add("hidden");
}

// Group round rows into per-player standings (mirrors showTournamentFinal/computeCut).
function manageGroupPlayers(rows) {
  const by = {};
  for (const r of rows) {
    const key = entryKey({ user_id: r.user_id, player_name: r.player_name });
    if (!by[key]) by[key] = { name: r.player_name, user_id: r.user_id || null, rounds: {}, total: 0 };
    by[key].rounds[r.round_num] = r;
    by[key].total += (r.to_par || 0);
  }
  return Object.values(by).sort((a, b) => a.total - b.total);
}

async function openTournamentManage() {
  if (!isTournamentAdmin()) return;
  document.getElementById("tournament-admin").classList.remove("hidden");
  await renderManageList();
}

async function renderManageList() {
  const body = document.getElementById("tm-body");
  document.getElementById("tm-title").innerHTML = '<span class="ic ic-flag-checkered"></span>Manage Tournaments';
  body.innerHTML = "<p class=\"ne-sub\">Loading…</p>";
  const all = await fetchAllTournaments();

  const courseOpts = COURSES.map(c =>
    "<option value=\"" + c.id + "\"" + (c.id === selectedCourseId ? " selected" : "") + ">" + escapeHTML(c.name) + "</option>"
  ).join("");
  const phaseLabel = { r1r2: "Rounds 1&2", r3r4: "Rounds 3&4", complete: "Complete" };
  const rowsHTML = all.length ? all.map(t => {
    const courseName = (COURSES.find(c => c.id === t.course_id) || {}).name || t.course_id;
    const created = new Date(t.created_at || t.r1r2_opens).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return "<button class=\"tm-row\" data-id=\"" + t.id + "\">" +
      "<span class=\"tm-row-name\">" + escapeHTML(t.name) + "</span>" +
      "<span class=\"tm-row-sub\">" + escapeHTML(courseName) + " · " + (phaseLabel[tournamentPhase(t)] || "—") + " · " + created + "</span>" +
      "</button>";
  }).join("") : "<p class=\"ne-sub\">No tournaments yet.</p>";

  body.innerHTML =
    "<div class=\"tm-new\"><select id=\"tm-new-course\">" + courseOpts + "</select>" +
    "<button class=\"menu-btn\" id=\"tm-new-btn\"><span class=\"ic ic-plus\"></span>New tournament</button></div>" +
    "<div class=\"tm-list\">" + rowsHTML + "</div>";

  body.querySelectorAll(".tm-row").forEach(el => {
    el.onclick = async () => {
      const t = all.find(x => x.id === el.dataset.id);
      if (t) await openManageDetail(t);
    };
  });
  document.getElementById("tm-new-btn").onclick = async () => {
    const cid = document.getElementById("tm-new-course").value;
    const courseName = (COURSES.find(c => c.id === cid) || {}).name || cid;
    const name = courseName + " — " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const t = await createTournament(name, cid);
    if (t) await openManageDetail(t); else setManageStatus("Create failed (admin only).");
  };
}

function setManageStatus(msg) {
  const el = document.getElementById("tm-status");
  if (el) el.textContent = msg || "";
}

async function openManageDetail(t) {
  const body = document.getElementById("tm-body");
  document.getElementById("tm-title").textContent = "Manage tournament";
  body.innerHTML = "<p class=\"ne-sub\">Loading…</p>";
  const rows = await fetchTournamentRounds(t.id);
  const players = manageGroupPlayers(rows);
  const { survivors } = computeCut(rows);
  const survivorKeys = new Set(survivors.map(s => entryKey(s)));
  _manageCondDraft = normalizeSettings(t.settings || gameDefaults);

  const openMs = new Date(t.r1r2_opens).getTime();
  const r1Len = Math.max(1, Math.round((new Date(t.r1r2_deadline).getTime() - openMs) / 60000));
  const r3Len = t.r3r4_deadline
    ? Math.max(1, Math.round((new Date(t.r3r4_deadline).getTime() - new Date(t.r3r4_opens || t.r1r2_deadline).getTime()) / 60000))
    : 60;

  const roundCell = (p, n) => p.rounds[n] ? "<span class=\"tm-rd done\">R" + n + "</span>" : "<span class=\"tm-rd\">R" + n + "</span>";
  const playersHTML = players.length ? players.map(p =>
    "<div class=\"tm-player\">" +
      "<div class=\"tm-player-main\"><b>" + escapeHTML(p.name || "—") + "</b>" +
        (survivorKeys.has(entryKey(p)) ? " <span class=\"tm-cut\">cut ✓</span>" : "") + "</div>" +
      "<div class=\"tm-player-rds\">" + [1,2,3,4].map(n => roundCell(p, n)).join("") +
        " <span class=\"tm-topar\">" + formatToPar(p.total) + "</span></div>" +
      "<button class=\"tm-dq\" data-key=\"" + entryKey(p) + "\">Remove</button>" +
    "</div>"
  ).join("") : "<p class=\"ne-sub\">No players entered yet.</p>";

  const condHTML = SETTING_DEFS.map(d =>
    "<button class=\"admin-toggle" + (_manageCondDraft[d.key] ? " active" : "") + "\" data-key=\"" + d.key + "\">" +
      "<span class=\"ic " + d.icon + "\"></span>" + d.label + "</button>"
  ).join("");

  body.innerHTML =
    "<button class=\"tm-back\" id=\"tm-back\">← All tournaments</button>" +
    "<div class=\"tm-sec\"><label class=\"tm-lbl\">Name</label>" +
      "<input id=\"tm-name\" type=\"text\" value=\"" + escapeHTML(t.name) + "\">" +
      "<button class=\"menu-btn secondary tm-save\" id=\"tm-save-name\">Save name</button></div>" +
    "<div class=\"tm-sec\"><label class=\"tm-lbl\">Round time limits (minutes)</label>" +
      "<div class=\"tm-times\"><span>R1/R2</span><input id=\"tm-r1len\" type=\"number\" min=\"1\" value=\"" + r1Len + "\">" +
        "<span>R3/R4</span><input id=\"tm-r3len\" type=\"number\" min=\"1\" value=\"" + r3Len + "\"></div>" +
      "<div class=\"tm-deadlines\" id=\"tm-deadlines\"></div>" +
      "<button class=\"menu-btn secondary tm-save\" id=\"tm-save-times\">Save times</button></div>" +
    "<div class=\"tm-sec\"><label class=\"tm-lbl\">Conditions</label>" +
      "<div class=\"admin-toggles\" id=\"tm-conds\">" + condHTML + "</div>" +
      "<button class=\"menu-btn secondary tm-save\" id=\"tm-save-conds\">Save conditions</button></div>" +
    "<div class=\"tm-sec\"><label class=\"tm-lbl\">Field (" + players.length + ")</label>" +
      "<div class=\"tm-players\">" + playersHTML + "</div></div>" +
    "<div class=\"tm-sec tm-danger\">" +
      "<button class=\"menu-btn secondary\" id=\"tm-end\">End now</button>" +
      "<button class=\"menu-btn secondary tm-del\" id=\"tm-delete\">Delete tournament</button></div>";

  function refreshDeadlines() {
    const r1 = (parseInt(document.getElementById("tm-r1len").value, 10) || 1) * 60000;
    const r3 = (parseInt(document.getElementById("tm-r3len").value, 10) || 1) * 60000;
    const w = computeWindows(openMs, r1, r3);
    document.getElementById("tm-deadlines").textContent =
      "R1/R2 ends " + new Date(w.r1r2_deadline).toLocaleString() + " · R3/R4 ends " + new Date(w.r3r4_deadline).toLocaleString();
  }
  document.getElementById("tm-r1len").oninput = refreshDeadlines;
  document.getElementById("tm-r3len").oninput = refreshDeadlines;
  refreshDeadlines();

  document.getElementById("tm-back").onclick = () => renderManageList();

  document.getElementById("tm-save-name").onclick = async () => {
    const name = document.getElementById("tm-name").value.trim();
    if (!name) return;
    setManageStatus((await updateTournament(t.id, { name })) ? "Name saved ✓" : "Save failed.");
    t.name = name;
  };

  document.getElementById("tm-save-times").onclick = async () => {
    const r1 = (parseInt(document.getElementById("tm-r1len").value, 10) || 1) * 60000;
    const r3 = (parseInt(document.getElementById("tm-r3len").value, 10) || 1) * 60000;
    const w = computeWindows(openMs, r1, r3);
    const ok = await updateTournament(t.id, {
      r1r2_deadline: w.r1r2_deadline, r3r4_opens: w.r3r4_opens, r3r4_deadline: w.r3r4_deadline });
    if (ok) Object.assign(t, w);
    setManageStatus(ok ? "Times saved ✓" : "Save failed.");
  };

  document.querySelectorAll("#tm-conds .admin-toggle").forEach(btn => {
    btn.onclick = () => {
      const k = btn.dataset.key;
      _manageCondDraft[k] = !_manageCondDraft[k];
      btn.classList.toggle("active", _manageCondDraft[k]);
      const def = SETTING_DEFS.find(d => d.key === k) || {};
      btn.innerHTML = '<span class="ic ' + (def.icon || "") + '"></span>' + (def.label || "");
    };
  });
  document.getElementById("tm-save-conds").onclick = async () => {
    const settings = normalizeSettings(_manageCondDraft);
    const ok = await updateTournament(t.id, { settings });
    if (ok) t.settings = settings;
    setManageStatus(ok ? "Conditions saved ✓" : "Save failed.");
  };

  body.querySelectorAll(".tm-dq").forEach(btn => {
    btn.onclick = async () => {
      const p = players.find(x => entryKey(x) === btn.dataset.key);
      if (!p || !confirm("Remove " + (p.name || "this player") + " from the tournament? Their rounds will be deleted.")) return;
      const ok = await removeTournamentPlayer(t.id, p);
      setManageStatus(ok ? "Player removed ✓" : "Remove failed.");
      if (ok) await openManageDetail(t);   // re-render field
    };
  });

  document.getElementById("tm-end").onclick = async () => {
    if (!confirm("End this tournament now? It will show as complete for all players.")) return;
    const ok = await endTournamentNow(t);
    if (ok) { t.r1r2_deadline = t.r3r4_deadline = new Date(Date.now() - 1000).toISOString(); }
    setManageStatus(ok ? "Tournament ended ✓" : "End failed.");
  };

  document.getElementById("tm-delete").onclick = async () => {
    if (!confirm("Delete \"" + t.name + "\" permanently? This removes all its scores.")) return;
    const ok = await deleteTournament(t.id);
    if (ok) { setManageStatus("Tournament deleted ✓"); await renderManageList(); }
    else setManageStatus("Delete failed.");
  };
}

(function wireManage() {
  const open = document.getElementById("menu-manage");
  if (open) open.addEventListener("click", openTournamentManage);
  const close = document.getElementById("tm-close");
  if (close) close.addEventListener("click", closeTournamentManage);
})();

// =====================================================================
//  Main loop
// =====================================================================
// Physics runs on a FIXED timestep, decoupled from render framerate. All TUNE
// constants (gravity, friction, powerFactor…) are calibrated at 60 Hz, and every
// step advances the ball by a per-FRAME velocity increment (b.x += b.vx). With the
// old "one update() per rAF" the ball's wall-clock speed was fps × units/frame — so
// in the heavy tilted-3D path (fps swings 7→60 as the warp cache parks) the ball
// visibly sped up and slowed down. The accumulator runs however many fixed 16.667ms
// substeps real time demands, so ball speed is now framerate-independent. Trajectory
// is unchanged (step math is identical and already step-count deterministic) — only
// the wall-clock duration is now stable. Substeps are pure arithmetic (cheap), and
// update() early-returns when the ball isn't moving.
const PHYS_DT = 1000 / 60;   // physics tick length (ms) — TUNE constants live at 60 Hz
const PHYS_MAX_STEPS = 5;    // spiral-of-death guard: cap catch-up per rendered frame
let _physAccum = 0;
let _physLast = performance.now();

// Idle prebake: while the tilted camera is parked (no active aim/touch/tilt
// transition), warm the angle buckets adjacent to the current one in the
// background so the next aim sweep starts mostly cache-hot. Budget-limited to
// one bucket bake per idle opportunity so it never causes a visible hitch.
let _prebakeIdleSince = 0;   // performance.now() of when "parked" began; 0 = not parked
let _prebakePending = false; // one bake request in flight
function maybePrebakeBucket() {
  const tilt3d = !!(view.kz && !HOLE.isRange && !greenView && !cine);
  const parked = tilt3d && aimKey === 0 && !cameraAiming && !camTouch &&
                 camera.tilt === camera.tTilt && !_warpMotion;
  if (!parked) { _prebakeIdleSince = 0; return; }
  const now = performance.now();
  if (!_prebakeIdleSince) { _prebakeIdleSince = now; return; }
  if (now - _prebakeIdleSince < TUNE.tBucketIdleGapMs || _prebakePending) return;
  _prebakePending = true;
  const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));
  schedule(() => { _prebakePending = false; prebakeOneBucket(); });
}
function prebakeOneBucket() {
  const cssW = window.innerWidth, cssH = window.innerHeight;
  const tilt3d = !!(view.kz && !HOLE.isRange && !greenView && !cine);
  // Re-check: parked state may have changed since this was scheduled.
  if (!tilt3d || aimKey !== 0 || cameraAiming || camTouch || camera.tilt !== camera.tTilt) return;
  const baseKey = baseWarpKey(cssW, cssH);
  const center = angleBucketIndex(camera.angle);
  const N = TUNE.tAngleBuckets, R = TUNE.tBucketPrebakeRadius;
  for (let d = 0; d <= R; d++) {
    const candidates = d === 0 ? [center] : [(center + d) % N, (center - d + N) % N];
    for (const i of candidates) {
      if (!_bucketCache.has(baseKey + "#" + i)) { bakeBucket(i, baseKey, cssW, cssH); return; }
    }
  }
}

function loop() {
  const now = performance.now();
  let elapsed = now - _physLast;
  _physLast = now;
  // Backgrounded tab / GC stall / first frame after load: don't fast-forward the
  // ball through a huge gap — clamp to a single tick.
  if (elapsed > 250) elapsed = PHYS_DT;
  _physAccum += elapsed;
  let steps = 0;
  while (_physAccum >= PHYS_DT && steps < PHYS_MAX_STEPS) {
    update();
    _physAccum -= PHYS_DT;
    steps++;
  }
  // Hit the cap (fps so low we can't keep up) — drop the backlog instead of
  // letting it grow unbounded (which would spiral into permanent catch-up).
  if (steps === PHYS_MAX_STEPS) _physAccum = 0;

  tickHoleDrop();
  tickCine();         // cinematic landing: cut in on the descent, close after rest
  cpuDriverTick();    // drive the live CPU opponent's shots (no-op unless in one)
  liveCameraTick();   // follow the opponent's ball while it's their turn
  updateLiveTurnUI(); // keep the whose-turn banner in sync (cheap; cached)
  updateCamera();
  updateStats();
  updateWindChip();
  updateGreenViewBtn();
  updateTiltBtn();
  update3DMode();  // cheap — no-ops unless mode/course actually changed
  if (render3D && window.Course3D) window.Course3D.render();
  // Apple ground sync (Butter Brook) happens inside draw() itself — see
  // appleGroundActive()/syncAppleGround() above.
  draw();
  maybePrebakeBucket();
  requestAnimationFrame(loop);
}

// Bridge for three3d/course3d.js (an ES module — it can't see this classic
// script's top-level `let`/`const`s directly). Render-only: Course3D never
// mutates physics state, only reads it each frame to place meshes/camera.
// Accessors (not snapshots) because `state`/`HOLE`/`course` are reassigned
// wholesale on every resetState()/setHole().
window.GolfBridge = {
  getCourse: () => course,
  getHole: () => HOLE,
  getWorld: () => WORLD,
  getState: () => state,
  getCamera: () => camera,
  getView: () => view,
  M_PER_UNIT,
  getYardsPerUnit: () => YARDS_PER_UNIT,
  BALL_RADIUS_UNITS,
  terrainZ,
  surfaceAt,
  isRender3D: () => render3D,
  // Mirrors drawTrees()'s own cache/guard exactly (game.js ~3938-3947) so the
  // 3D renderer shares the identical tree list the 2D renderer already
  // computed — no duplicate compute, no divergent placement. Mask decodes
  // async; don't bake from the OSM fallback while a real mask is still en route.
  getTrees: () => {
    const holder = course || HOLE;
    const hasMask = !!(HOLE._mask && HOLE._mask.lab);
    if (!hasMask && HOLE._maskExpected) return [];
    // Course3D builds its instanced meshes ONCE per course (no per-frame cache
    // key like drawTrees) — hold the list back until the aerial is decoded so
    // that one build already includes the OB-forest augmentation from the
    // photo. Same-origin static file alongside the course JSON, so it lands.
    if (hasMask && HOLE.aerial && HOLE.aerial.file && !HOLE._imgReady) return [];
    const treeSig = hasMask + ":" + !!HOLE._imgReady;
    if (!holder._trees || holder._treesFromMask !== treeSig) {
      holder._trees = buildTrees();
      holder._treesFromMask = treeSig;
    }
    return holder._trees || [];
  },
};

// Boot to the home menu over a course backdrop. Pinehurst loads in the
// background so "Play Course" starts instantly (keeps the fallback on error).
setHole(FALLBACK_HOLE);
buildCourseList();
updateMenuPlayerLine();   // reflect saved player name (leaderboard identity)
loop();
showMenu();
maybeJoinFromLink();      // ?m=CODE challenge link — prompt to join, no-op if absent
probeBakeApi();           // reveal admin "Add course" only if the bake server is up
loadManifest().then(() => {
  buildCourseList();      // refresh list from courses/manifest.json (admin-baked courses)
  renderMenuChips();      // featured course needs the real manifest
  return loadCourse(selectedCourseId);
}).catch((e) => {
  console.warn("Course load failed, using fallback hole:", e);
});

// Auth boot: capture magic-link tokens, restore/validate the session, load the
// profile, and flush any rounds queued while logged out. All best-effort.
(async function bootAuth() {
  if (!LB_ON()) { updateAuthUI(); return; }
  try {
    parseAuthRedirect();
    await restoreSession();
    if (isLoggedIn()) {
      await ensureProfile();
      await flushPendingRounds();
    }
    // global defaults set by the admin — applies to every player
    const gs = await fetchGameSettings();
    if (gs) { gameDefaults = normalizeSettings(gs); activeSettings = Object.assign({}, gameDefaults); }
  } catch (e) { console.warn("Auth boot failed:", e); }
  updateMenuPlayerLine();
  track("app_open", { signed_in: isLoggedIn() });
})();

// Dev-drive (cousin of ?course=/?3d=1): ?devdrive=1 long-polls a local relay
// (tools/devdrive_server.py) for JS to eval and pushes the result back —
// remote control for environments with no automation hooks (iOS simulator
// WKWebView). Dev-only: inert without the query param, and the relay only
// listens on 127.0.0.1.
if (new URLSearchParams(location.search).get("devdrive") === "1") {
  (async function devdrive() {
    const base = "http://127.0.0.1:8787";
    for (;;) {
      try {
        const r = await fetch(base + "/pull");
        const { js } = await r.json();
        if (!js) continue;
        let out;
        try {
          out = await (0, eval)(js);           // indirect eval -> global scope
          out = { ok: true, value: out === undefined ? null : out };
        } catch (e) {
          out = { ok: false, error: String(e && e.stack || e) };
        }
        let body;
        try { body = JSON.stringify(out); }
        catch (e) { body = JSON.stringify({ ok: out.ok, value: String(out.value) }); }
        await fetch(base + "/push", { method: "POST", body });
      } catch (e) {
        await new Promise((res) => setTimeout(res, 2000)); // relay down — retry gently
      }
    }
  })();
}
