// Headless DOM / canvas / browser stubs for running game.js under JavaScriptCore
// (osascript -l JavaScript). NOT loaded by the game — test scaffolding only.
//
// Used by tools/engine_smoke.js and tools/putt_matrix.js. JXA has no require(),
// so each harness readFile()s this and concatenates it ahead of ballistics.js +
// game.js. Keep it plain ES5-ish source: it is eval'd, not imported.
//
// processAerial() uses only drawImage/fillRect (no getImageData), so the real
// aerial pipeline runs against a stub Image that fires onload synchronously —
// the photoreal path is exercised for real, not faked.

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
  createDocumentFragment: function(){ return __el(); },
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
var getComputedStyle = function(){ return { getPropertyValue: function(){ return ""; } }; };
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
// game.js reads these as BARE globals at module load (location.search, history.replaceState,
// new URLSearchParams(location.search)) — mirror window's onto the global scope + stub
// URLSearchParams if JSC lacks it, so the harness doesn't ReferenceError before draw() runs.
var location = window.location;
var history = window.history;
if (typeof URLSearchParams === "undefined") {
  URLSearchParams = function(){ return { get: function(){ return null; }, has: function(){ return false; }, getAll: function(){ return []; }, toString: function(){ return ""; } }; };
}
// Advance the sim until the ball is at rest, returning the ticks spent. Shared so
// every harness settles a shot the same way (the putt gate reads the count — a
// putt that never rests is a physics bug, not a slow test).
function settle(maxTicks){
  var i = 0;
  for (; i < maxTicks && (state.moving || state.airborne); i++) update();
  return i;
}
var __RESULT__ = null;
