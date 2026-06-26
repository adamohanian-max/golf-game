// Engine smoke test — run via:  osascript -l JavaScript tools/engine_smoke.js <id> <repoRoot>
//
// Loads game.js into a headless JavaScriptCore environment with stubbed
// DOM/canvas/Image/fetch, points the game at courses/<id>.json, then for EVERY
// hole runs draw() in BOTH render modes (vector + photoreal) plus a full swing
// and a putt. No exception across all holes = pass (exit 0). Any throw =>
// non-zero exit with the failing holes, so verify_course.py can gate on it.
//
// processAerial() uses only drawImage/fillRect (no getImageData), so the real
// aerial pipeline runs against a stub Image that fires onload synchronously —
// the photoreal path is exercised for real, not faked.

ObjC.import('Foundation');

function readFile(p) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(p, 4 /* NSUTF8 */, null);
  if (!s) throw new Error("cannot read " + p);
  return ObjC.unwrap(s);
}

var STUBS = `
// ---- headless DOM / canvas / browser stubs --------------------------------
var __noop = function(){ return undefined; };
function __ctx(){
  var store = { canvas: { width: 1170, height: 2532 } };
  function imgData(w, h){ w = w|0 || 1; h = h|0 || 1;
    return { width: w, height: h, data: new Array(w*h*4).fill(0) }; }
  var grad = { addColorStop: __noop };
  var H = {
    createImageData: function(a, b){ var w = (a && a.width) || a, h = (a && a.height) || b; return imgData(w, h); },
    getImageData: function(x, y, w, h){ return imgData(w, h); },
    createLinearGradient: function(){ return grad; },
    createRadialGradient: function(){ return grad; },
    createPattern: function(){ return {}; },
    measureText: function(){ return { width: 0 }; },
    isPointInPath: function(){ return false; },
    getContextAttributes: function(){ return {}; }
  };
  return new Proxy(store, {
    get: function(t, p){ if (p in H) return H[p]; if (p in t) return t[p]; return __noop; },
    set: function(t, p, v){ t[p] = v; return true; }
  });
}
function __el(){
  var store = { style: {}, dataset: {},
    classList: { add: __noop, remove: __noop, toggle: __noop, contains: function(){ return false; } },
    children: [], childNodes: [],
    textContent: "", innerHTML: "", innerText: "", value: "", checked: false,
    width: 1170, height: 2532, clientWidth: 1170, clientHeight: 2532,
    getContext: function(){ return __ctx(); },
    getBoundingClientRect: function(){ return { left:0, top:0, right:1170, bottom:2532, width:1170, height:2532 }; },
    querySelector: function(){ return __el(); },
    querySelectorAll: function(){ return []; },
    appendChild: function(c){ return c; },
    insertBefore: function(c){ return c; },
    removeChild: function(c){ return c; },
    setAttribute: __noop, removeAttribute: __noop, getAttribute: function(){ return null; },
    addEventListener: __noop, removeEventListener: __noop, dispatchEvent: __noop,
    closest: function(){ return null; }, contains: function(){ return false; },
    focus: __noop, blur: __noop, click: __noop, remove: __noop,
    requestPointerLock: __noop, scrollIntoView: __noop
  };
  return new Proxy(store, {
    get: function(t, p){ if (p in t) return t[p]; return __noop; },
    set: function(t, p, v){ t[p] = v; return true; }
  });
}
var __els = {};
var document = {
  getElementById: function(id){ return __els[id] || (__els[id] = __el()); },
  createElement: function(){ return __el(); },
  createElementNS: function(){ return __el(); },
  createTextNode: function(){ return __el(); },
  querySelector: function(){ return __el(); },
  querySelectorAll: function(){ return []; },
  getElementsByClassName: function(){ return []; },
  addEventListener: __noop, removeEventListener: __noop,
  body: __el(), documentElement: __el(), head: __el(),
  hidden: false, visibilityState: "visible", cookie: ""
};
function FakeImage(){
  var self = this; this.width = 2048; this.height = 2048;
  this.onload = null; this.onerror = null;
  this.addEventListener = function(ev, fn){ if (ev === "load") self.onload = fn; };
  Object.defineProperty(this, "src", { set: function(v){
    self._src = v; if (typeof self.onload === "function") self.onload();
  }, get: function(){ return self._src; } });
}
var Image = FakeImage;
var __deep = new Proxy(function(){ return __deep; }, {
  get: function(){ return __deep; }, apply: function(){ return __deep; }
});
var requestAnimationFrame = function(){ return 0; };
var cancelAnimationFrame = __noop;
var setTimeout = function(){ return 0; };
var clearTimeout = __noop;
var setInterval = function(){ return 0; };
var clearInterval = __noop;
var performance = { now: function(){ return Date.now(); } };
var fetch = function(){ return new Promise(function(){}); };          // never resolves
var localStorage = { getItem: function(){ return null; }, setItem: __noop, removeItem: __noop, clear: __noop };
var sessionStorage = localStorage;
var navigator = { userAgent: "jsc", platform: "headless", maxTouchPoints: 0, language: "en", vendor: "" };
var console = { log: __noop, warn: __noop, error: __noop, info: __noop, debug: __noop };
var supabase = __deep;
// Leave AudioContext undefined so ensureAudio() returns null and every sound
// helper hits its 'if (!ac) return' guard — audio isn't under test.
var window = {
  innerWidth: 1170, innerHeight: 2532, devicePixelRatio: 2,
  addEventListener: __noop, removeEventListener: __noop,
  requestAnimationFrame: requestAnimationFrame, cancelAnimationFrame: cancelAnimationFrame,
  matchMedia: function(){ return { matches: false, addEventListener: __noop, addListener: __noop }; },
  getComputedStyle: function(){ return { getPropertyValue: function(){ return ""; } }; },
  localStorage: localStorage, sessionStorage: sessionStorage, navigator: navigator,
  performance: performance, location: { href: "", search: "", hash: "", pathname: "/" },
  AudioContext: undefined, webkitAudioContext: undefined,
  scrollTo: __noop, setTimeout: setTimeout, clearTimeout: clearTimeout, fetch: fetch,
  history: { pushState: __noop, replaceState: __noop }
};
var __RESULT__ = null;
`;

var POSTLUDE = `
;(function(){
  var errors = [];
  function settle(maxTicks){ for (var i = 0; i < maxTicks && (state.moving || state.airborne); i++) update(); }
  try {
    mode = "course";
    course = __COURSE__;                 // game.js's top-level 'let course'
    course._dem = null; course._greens = null; course._img = undefined; course._imgReady = false;
    var hs = course.holes;
    for (var i = 0; i < hs.length; i++) {
      var rec = hs[i];
      try {
        setHole(rec);                    // frames camera + resets state + loads aerial (onload sync)
        draw();                          // photoreal (image ready after hole 0)
        var ready = HOLE._imgReady; HOLE._imgReady = false; draw(); HOLE._imgReady = ready;  // vector
        // full swing toward the pin
        resetState();
        launchShot(Math.atan2(HOLE.holePos.y - HOLE.teePos.y, HOLE.holePos.x - HOLE.teePos.x), 1, 0, false);
        settle(900);
        // putt: place the ball just off the cup on the green and roll it in
        state.ball.x = HOLE.holePos.x + 0.7; state.ball.y = HOLE.holePos.y + 0.7;
        state.ball.vx = state.ball.vy = state.ball.z = state.ball.vz = state.ball.spin = 0;
        state.moving = false; state.airborne = false;
        launchShot(Math.atan2(HOLE.holePos.y - state.ball.y, HOLE.holePos.x - state.ball.x), 0.15, 0, true);
        settle(900);
      } catch (e) { errors.push("hole " + rec.num + ": " + ((e && e.stack) || e)); }
    }
  } catch (e) { errors.push("setup: " + ((e && e.stack) || e)); }
  __RESULT__ = { ok: errors.length === 0, errors: errors, holes: (course && course.holes ? course.holes.length : 0) };
})();
JSON.stringify(__RESULT__);
`;

function run(argv) {
  var id = argv[0];
  var base = argv[1];
  if (!id || !base) throw new Error("usage: engine_smoke.js <id> <repoRoot>");
  var gameSrc = readFile(base + "/game.js");
  var courseJson = readFile(base + "/courses/" + id + ".json");
  var big = STUBS + "\nvar __COURSE__ = " + courseJson + ";\n" + gameSrc + "\n" + POSTLUDE;
  var out = eval(big);
  var res = JSON.parse(out);
  if (!res.ok) {
    throw new Error("ENGINE SMOKE FAIL (" + res.errors.length + " hole(s)):\n  " +
                    res.errors.slice(0, 8).join("\n  "));
  }
  return "engine smoke PASS: " + res.holes + " holes (draw vector+photoreal, swing, putt)";
}
