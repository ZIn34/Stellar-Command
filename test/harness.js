/* Loads the game's script into node with just enough of a browser around it to
   run the simulation headless. The game is one HTML file by design, so there is
   nothing to import: we pull the <script> out and evaluate it in a vm context
   whose globals are stubs.

   Only the simulation has to work. Anything that draws, plays a sound or talks
   to the network is a no-op that hands back something plausible. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'stellar-command.html');

function ctx2d() {
  const grad = { addColorStop() {} };
  const c = {
    canvas: { width: 1280, height: 720 },
    createLinearGradient() { return grad; },
    createRadialGradient() { return grad; },
    createConicGradient() { return grad; },
    createPattern() { return null; },
    measureText(t) { return { width: String(t || '').length * 6 }; },
    getImageData(x, y, w, h) {
      const n = Math.max(1, (w | 0) * (h | 0) * 4);
      return { data: new Uint8ClampedArray(n), width: w | 0, height: h | 0 };
    },
    createImageData(w, h) {
      const n = Math.max(1, (w | 0) * (h | 0) * 4);
      return { data: new Uint8ClampedArray(n), width: w | 0, height: h | 0 };
    },
    putImageData() {},
    setTransform() {}, resetTransform() {},
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    isPointInPath() { return false; }, isPointInStroke() { return false; }
  };
  const noop = ['save', 'restore', 'scale', 'rotate', 'translate', 'transform',
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo',
    'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect',
    'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect',
    'fillText', 'strokeText', 'drawImage', 'setLineDash', 'getLineDash',
    'drawFocusIfNeeded'];
  for (const m of noop) c[m] = function () {};
  return c;
}

/* One stub element shape covers every node the game touches: it accepts any
   call and exposes the handful of fields that get read back. */
function stubNode(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    nodeType: 1,
    children: [], childNodes: [],
    /* A real CSSStyleDeclaration also has these; the game sets CSS custom
       properties through them, so the stub needs them or loading throws. */
    style: { _p:{},
      setProperty(k,v){ this._p[k]=v; },
      getPropertyValue(k){ return this._p[k]===undefined?'':this._p[k]; },
      removeProperty(k){ const v=this._p[k]; delete this._p[k]; return v; } },
    dataset: {},
    textContent: '', innerHTML: '', innerText: '', value: '', title: '',
    width: 1280, height: 720, checked: false, disabled: false,
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; }
    },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, insertBefore(c) { return c; },
    replaceChildren() { this.children.length = 0; },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return true; },
    focus() {}, blur() {}, click() {}, scrollIntoView() {}, select() {},
    getBoundingClientRect() {
      return { x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720,
               width: 1280, height: 720 };
    },
    querySelector() { return stubNode('div'); },
    querySelectorAll() { return []; },
    closest() { return null; },
    getContext() { return ctx2d(); },
    toDataURL() { return 'data:image/png;base64,'; },
    toBlob(cb) { if (cb) cb({}); },
    play() { return Promise.resolve(); }, pause() {}, load() {},
    requestFullscreen() { return Promise.resolve(); }
  };
}

function makeSandbox() {
  const listeners = {};
  const byId = new Map();

  const document = {
    documentElement: stubNode('html'),
    head: stubNode('head'),
    body: stubNode('body'),
    visibilityState: 'visible',
    hidden: false,
    fullscreenElement: null,
    createElement(tag) { return stubNode(tag); },
    createElementNS(ns, tag) { return stubNode(tag); },
    createTextNode(t) { return { textContent: t }; },
    createDocumentFragment() { return stubNode('fragment'); },
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, stubNode('div'));
      return byId.get(id);
    },
    querySelector() { return stubNode('div'); },
    querySelectorAll() { return []; },
    getElementsByTagName() { return []; },
    getElementsByClassName() { return []; },
    addEventListener(k, f) { (listeners[k] = listeners[k] || []).push(f); },
    removeEventListener() {},
    exitFullscreen() { return Promise.resolve(); }
  };

  let rafId = 0;

  class StubImage {
    constructor() { this.width = 1; this.height = 1; }
    set src(v) { this._src = v; if (typeof this.onload === 'function') this.onload(); }
    get src() { return this._src; }
    addEventListener() {}
  }
  class StubSocket {
    constructor() { this.readyState = 0; }
    send() {} close() { this.readyState = 3; }
    addEventListener() {} removeEventListener() {}
  }
  const param = () => ({
    value: 1, setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, setTargetAtTime() {},
    cancelScheduledValues() {}
  });
  class StubAudio {
    constructor() {
      this.state = 'running'; this.destination = {};
      this.currentTime = 0; this.sampleRate = 48000;
    }
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
    createOscillator() {
      return { frequency: param(), detune: param(), type: 'sine',
               connect() {}, disconnect() {}, start() {}, stop() {} };
    }
    createBuffer(ch, len) {
      return { length: len,
               getChannelData() { return new Float32Array(Math.max(1, len | 0)); } };
    }
    createBufferSource() {
      return { buffer: null, playbackRate: param(), loop: false,
               connect() {}, disconnect() {}, start() {}, stop() {} };
    }
    createBiquadFilter() {
      return { frequency: param(), Q: param(), gain: param(),
               type: 'lowpass', connect() {}, disconnect() {} };
    }
    createDynamicsCompressor() {
      return { threshold: param(), knee: param(), ratio: param(),
               attack: param(), release: param(), connect() {}, disconnect() {} };
    }
    createStereoPanner() { return { pan: param(), connect() {}, disconnect() {} }; }
    createWaveShaper() {
      return { curve: null, oversample: 'none', connect() {}, disconnect() {} };
    }
    createConvolver() { return { buffer: null, connect() {}, disconnect() {} }; }
    createDelay() { return { delayTime: param(), connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }

  const sandbox = {
    document,
    navigator: {
      userAgent: 'node', maxTouchPoints: 0, language: 'en-US', languages: ['en-US'],
      clipboard: { writeText() { return Promise.resolve(); } },
      vibrate() {}, wakeLock: undefined, hardwareConcurrency: 4
    },
    location: {
      href: 'http://localhost/stellar-command.html', protocol: 'http:',
      host: 'localhost', hostname: 'localhost', port: '',
      pathname: '/stellar-command.html',
      search: '', hash: '', origin: 'http://localhost',
      reload() {}, replace() {}, assign() {}
    },
    localStorage: (function () {
      const m = new Map();
      return {
        getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
        setItem: (k, v) => { m.set(String(k), String(v)); },
        removeItem: k => { m.delete(String(k)); },
        clear: () => m.clear(),
        key: i => [...m.keys()][i] || null,
        get length() { return m.size; }
      };
    })(),
    sessionStorage: (function () {
      const m = new Map();
      return {
        getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
        setItem: (k, v) => { m.set(String(k), String(v)); },
        removeItem: k => { m.delete(String(k)); }, clear: () => m.clear(),
        key: () => null, get length() { return m.size; }
      };
    })(),
    performance: { now: () => Date.now() },
    requestAnimationFrame() { return ++rafId; },
    cancelAnimationFrame() {},
    requestIdleCallback() { return ++rafId; },
    setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask,
    console,
    Image: StubImage,
    WebSocket: StubSocket,
    AudioContext: StubAudio,
    webkitAudioContext: StubAudio,
    OffscreenCanvas: class {
      constructor(w, h) { this.width = w; this.height = h; }
      getContext() { return ctx2d(); }
      convertToBlob() { return Promise.resolve({}); }
    },
    Worker: class {
      constructor() {} postMessage() {} terminate() {}
      addEventListener() {} removeEventListener() {}
    },
    Blob: class { constructor(p) { this.parts = p; } },
    File: class { constructor() {} },
    FileReader: class {
      readAsText() { this.result = ''; if (this.onload) this.onload(); }
      readAsDataURL() { this.result = ''; if (this.onload) this.onload(); }
    },
    URL: { createObjectURL() { return 'blob:stub'; }, revokeObjectURL() {} },
    matchMedia() {
      return { matches: false, media: '',
               addEventListener() {}, removeEventListener() {},
               addListener() {}, removeListener() {} };
    },
    fetch() {
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve({}), text: () => Promise.resolve('') });
    },
    alert() {}, confirm() { return false; }, prompt() { return null; },
    screen: {
      width: 1920, height: 1080,
      orientation: { lock() { return Promise.resolve(); }, type: 'landscape-primary' }
    },
    devicePixelRatio: 1,
    innerWidth: 1280, innerHeight: 720,
    outerWidth: 1280, outerHeight: 720,
    scrollX: 0, scrollY: 0,
    addEventListener(k, f) { (listeners[k] = listeners[k] || []).push(f); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    getComputedStyle() { return { getPropertyValue() { return ''; } }; },
    /* The map codec base64s its share codes; a browser has these on window. */
    btoa(str) { return Buffer.from(String(str), 'binary').toString('base64'); },
    atob(b64) { return Buffer.from(String(b64), 'base64').toString('binary'); },
    crypto: {
      getRandomValues(a) {
        for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0;
        return a;
      },
      randomUUID() { return '00000000-0000-4000-8000-000000000000'; }
    },
    structuredClone: v => JSON.parse(JSON.stringify(v))
  };

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;
  sandbox.__listeners = listeners;
  return sandbox;
}

/* The game is the last <script> block in the file. */
function loadGame() {
  const html = fs.readFileSync(HTML, 'utf8');
  const blocks = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);
  if (!blocks.length) throw new Error('no <script> block found in ' + HTML);
  const code = blocks[blocks.length - 1];
  const sandbox = makeSandbox();
  const context = vm.createContext(sandbox);
  try {
    vm.runInContext(code, context, { filename: 'stellar-command.html', timeout: 120000 });
  } catch (e) {
    throw new Error('the game script threw while loading: ' + e.message +
                    '\n' + (e.stack || ''));
  }
  /* Top-level const/let live in the context's global lexical scope, not on
     the sandbox object, so UDEF and friends are only reachable by evaluating
     in the same context. run() is how a test gets at them. */
  sandbox.run = expr => vm.runInContext(expr, context);
  return sandbox;
}

module.exports = { loadGame, stubNode, ctx2d };
