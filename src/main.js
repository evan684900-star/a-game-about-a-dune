// A Game About a Dune — boucle principale, caméra, entrées, interface.
import * as THREE from '../vendor/three.module.min.js';
import { Sim } from './sim.js';
import { makeSwell, makeDetail } from './waves.js';
import { createWorld } from './world.js';
import { Particles } from './particles.js';
import { Tools } from './tools.js';
import { Sound } from './audio.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#view');

function fatal(msg) {
  $('#fatal').style.display = 'grid';
  $('#fatalMsg').textContent = msg;
}

function start() {
  const params = new URLSearchParams(location.search);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const quality = params.get('q') || (coarse ? 'low' : 'high');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    return fatal('Ce jeu a besoin de WebGL 2, indisponible sur cet appareil ou ce navigateur.');
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.44;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1.5 : 2);

  const H0 = 1.2;
  const swell = makeSwell(H0);
  const detail = makeDetail();
  const sim = new Sim({ N: quality === 'low' ? 176 : 240, L: 26, h0: H0, waves: swell });
  const world = createWorld(renderer, sim, swell, detail, quality);
  const { scene, U } = world;
  const particles = new Particles(scene, sim);
  const tools = new Tools(scene, sim, particles);
  const sound = new Sound();
  tools.onEvent = (name, v) => {
    if (name === 'dig') sound.dig(v);
    else if (name === 'stamp') sound.stamp();
    else if (name === 'scoop') sound.scoop();
    else if (name === 'scrape') sound.scrape(v);
    else if (name === 'pat') sound.pat();
  };

  const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 7000);
  // image de la scène sans l'eau, pour la réfraction (HDR si l'appareil le permet)
  const hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const rt = new THREE.WebGLRenderTarget(4, 4, {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    depthBuffer: true,
  });
  rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
  U.uScene.value = rt.texture;

  // ---------- caméra orbitale ----------
  const cam = { az: -0.55, pol: 1.12, dist: 15.5, tx: 0.6, ty: 0.5, tz: 0.4 };
  const camT = { ...cam };
  const camRight = new THREE.Vector3();
  function applyCamera(dt) {
    const k = 1 - Math.exp(-12 * dt);
    for (const key in cam) cam[key] += (camT[key] - cam[key]) * k;
    const sp = Math.sin(cam.pol);
    camera.position.set(
      cam.tx + cam.dist * sp * Math.sin(cam.az),
      cam.ty + cam.dist * Math.cos(cam.pol),
      cam.tz + cam.dist * sp * Math.cos(cam.az)
    );
    // la caméra reste au-dessus du sable et de l'eau
    const gx = THREE.MathUtils.clamp(camera.position.x, -12.9, 12.9),
      gz = THREE.MathUtils.clamp(camera.position.z, -12.9, 12.9);
    const floor = Math.max(sim.heightAt(gx, gz), 0.15) + 0.35;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    camera.updateMatrixWorld();
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camRight.y = 0;
    camRight.normalize();
  }
  function orbit(dx, dy) {
    camT.az -= dx * 0.006;
    camT.pol = THREE.MathUtils.clamp(camT.pol - dy * 0.005, 0.18, 1.5);
  }
  function zoom(f) {
    camT.dist = THREE.MathUtils.clamp(camT.dist * f, 3.5, 45);
  }
  function pan(dx, dy) {
    const s = cam.dist * 0.0012;
    const fx = -Math.sin(cam.az),
      fz = -Math.cos(cam.az);
    camT.tx = THREE.MathUtils.clamp(camT.tx - camRight.x * dx * s - fx * dy * s, -8, 8);
    camT.tz = THREE.MathUtils.clamp(camT.tz - camRight.z * dx * s - fz * dy * s, -8, 8);
  }

  // ---------- entrées ----------
  const pointers = new Map();
  const mouse = { x: 0, y: 0, has: false };
  let cursor = null;
  let pinch = 0;
  let dragMode = null; // 'tool' | 'orbit' | 'pan'
  const ndc = new THREE.Vector3();
  const dir = new THREE.Vector3();

  function pick() {
    if (!mouse.has) return (cursor = null);
    const r = canvas.getBoundingClientRect();
    ndc.set(((mouse.x - r.left) / r.width) * 2 - 1, -((mouse.y - r.top) / r.height) * 2 + 1, 0.5).unproject(camera);
    dir.copy(ndc).sub(camera.position).normalize();
    const p = camera.position;
    cursor = sim.raycast(p.x, p.y, p.z, dir.x, dir.y, dir.z);
    return cursor;
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    canvas.focus({ preventScroll: true });
    sound.start();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.has = true;
    if (pointers.size === 2) {
      // deuxième doigt : on passe en navigation
      tools.onUp();
      dragMode = 'orbit';
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    if (e.pointerType === 'mouse' && e.button === 2) dragMode = 'orbit';
    else if (e.pointerType === 'mouse' && e.button === 1) dragMode = 'pan';
    else if (tools.current === 'camera') dragMode = 'orbit';
    else {
      dragMode = 'tool';
      pick();
      tools.update(0, cursor, camRight);
      tools.onDown();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (e.pointerType === 'mouse' || p) {
      if (pointers.size < 2) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.has = true;
      }
    }
    if (!p) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) zoom(pinch / d);
      pinch = d;
      orbit(dx * 0.5, dy * 0.5);
    } else if (dragMode === 'orbit') orbit(dx, dy);
    else if (dragMode === 'pan') pan(dx, dy);
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (dragMode === 'tool') tools.onUp();
      dragMode = null;
      if (e.pointerType !== 'mouse') mouse.has = false;
    }
    pinch = 0;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && pointers.size === 0) mouse.has = false;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom(Math.exp(e.deltaY * 0.0012));
    },
    { passive: false }
  );

  // ---------- interface ----------
  const buttons = [...document.querySelectorAll('#bar button')];
  const statusEl = $('#status');
  const moldLabel = document.querySelector('#bar button[data-tool=mold] .lbl');
  function selectTool(name) {
    // recliquer sur le moule déjà choisi change sa forme
    if (name === 'mold' && tools.current === 'mold' && tools.cycleMold()) moldLabel.textContent = tools.mold.def.name;
    if (!tools.setTool(name)) return;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.tool === name));
    canvas.style.cursor = name === 'camera' ? 'grab' : 'crosshair';
  }
  for (const b of buttons) b.addEventListener('click', () => selectTool(b.dataset.tool));
  selectTool('shovel');
  const help = $('#help');
  const toggleHelp = (open) => help.classList.toggle('open', open);
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = { 1: 'camera', 2: 'shovel', 3: 'trowel', 4: 'hand', 5: 'bucket', 6: 'mold', 7: 'water', 8: 'hose' }[e.key];
    if (k) selectTool(k);
    if (e.key === 'Escape') toggleHelp(false);
    const step = 0.08;
    if (e.key === 'ArrowLeft') camT.az -= step;
    if (e.key === 'ArrowRight') camT.az += step;
    if (e.key === 'ArrowUp') camT.pol = Math.max(0.18, camT.pol - step);
    if (e.key === 'ArrowDown') camT.pol = Math.min(1.5, camT.pol + step);
  });
  // réglages : houle, vent, heure
  const fr = (v, d) => v.toFixed(d).replace('.', ',');
  const settings = {
    swell: { el: $('#swell'), out: $('#swellV'), apply: (v) => (sim.swell = v), text: (v) => `× ${fr(v, 1)}` },
    wind: { el: $('#wind'), out: $('#windV'), apply: (v) => (sim.wind = v), text: (v) => `${Math.round(v * 3.6)} km/h` },
    hour: {
      el: $('#hour'),
      out: $('#hourV'),
      apply: (v) => world.setTimeOfDay(v),
      text: (v) => `${Math.floor(v)} h ${String(Math.round((v % 1) * 60)).padStart(2, '0')}`,
    },
  };
  function setSetting(key, v) {
    const s = settings[key];
    v = Math.min(+s.el.max, Math.max(+s.el.min, +v));
    if (!Number.isFinite(v)) return;
    s.el.value = v;
    s.apply(v);
    s.out.textContent = s.text(v);
  }
  for (const key in settings) {
    settings[key].el.addEventListener('input', (e) => setSetting(key, e.target.value));
    // on rend le clavier au jeu dès que le curseur est lâché (sinon les
    // chiffres sont ignorés et les flèches changent le réglage)
    const release = (e) => e.target.blur();
    settings[key].el.addEventListener('change', release);
    settings[key].el.addEventListener('pointerup', release);
    setSetting(key, settings[key].el.value);
  }

  // son
  const muteBtn = $('#mute');
  const showMute = () => muteBtn.setAttribute('aria-pressed', String(!sound.muted));
  muteBtn.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    showMute();
  });
  showMute();
  window.addEventListener('keydown', () => sound.start(), { once: true });
  document.addEventListener('visibilitychange', () => {
    sound.pause(document.hidden);
    if (document.hidden) save();
  });

  // ---------- sauvegarde de l'île (dans ce navigateur) ----------
  const SAVE_KEY = 'dune-save-v1';
  const b64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (str) => {
    const s = atob(str);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  };
  function save() {
    if (params.has('nosave')) return;
    try {
      const n = sim.N * sim.N;
      // hauteurs au quart de millimètre, humidité sur 8 bits
      const s16 = new Uint16Array(n),
        m8 = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        s16[i] = Math.min(65535, Math.max(0, Math.round((sim.s[i] + sim.sed[i] + 8) * 4000)));
        m8[i] = Math.round(sim.m[i] * 255);
      }
      const data = { N: sim.N, L: sim.L, s: b64(new Uint8Array(s16.buffer)), m: b64(m8) };
      for (const key in settings) data[key] = +settings[key].el.value;
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      /* stockage indisponible ou plein : on joue sans sauvegarde */
    }
  }
  function restore() {
    if (params.has('nosave')) return;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      for (const key in settings) if (key in data) setSetting(key, data[key]);
      if (data.N !== sim.N || data.L !== sim.L) return;
      const s16 = new Uint16Array(unb64(data.s).buffer),
        m8 = unb64(data.m);
      const s = new Float32Array(s16.length),
        m = new Float32Array(m8.length);
      for (let i = 0; i < s.length; i++) {
        s[i] = s16[i] / 4000 - 8;
        m[i] = m8[i] / 255;
      }
      sim.setTerrain(s, m);
    } catch (e) {
      /* sauvegarde illisible : on garde l'île neuve */
    }
  }
  restore();
  setInterval(save, 20000);
  window.addEventListener('pagehide', save);

  $('#reset').addEventListener('click', () => {
    if (!window.confirm('Réinitialiser l’île ? Tout ce que tu as construit sera effacé.')) return;
    sim.reset();
    particles.clear();
    tools.reset();
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {}
  });
  $('#helpBtn').addEventListener('click', () => toggleHelp(true));
  $('#helpClose').addEventListener('click', () => {
    toggleHelp(false);
    try {
      localStorage.setItem('dune-help', '1');
    } catch (e) {}
  });
  help.addEventListener('click', (e) => {
    if (e.target === help) toggleHelp(false);
  });
  let seen = false;
  try {
    seen = !!localStorage.getItem('dune-help');
  } catch (e) {}
  if (!seen && !params.has('nohelp')) toggleHelp(true);

  // ---------- dimensionnement ----------
  const size = new THREE.Vector2();
  function resize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // sur écran étroit, on élargit le champ pour garder l'île entière
    camera.fov = w / h < 1 ? 42 + (1 - w / h) * 26 : 42;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(size);
    U.uRes.value.copy(size);
    rt.setSize(Math.max(2, size.x >> 1), Math.max(2, size.y >> 1));
    particles.uScale.value = size.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
    particles.uHalfRes.value.set(size.x / 2, size.y / 2);
  }
  window.addEventListener('resize', resize);
  resize();
  if (camera.aspect < 1) cam.dist = camT.dist = 15.5 * (1 + (1 - camera.aspect) * 0.45);

  // ---------- boucle ----------
  let last = performance.now();
  let time = 0;
  let slow = 0,
    lastStatus = '';
  const state = { fps: 60 };
  const audio = { water: 0, sand: 0 };
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(Math.max(raw, 0.001), 1 / 20);
    time += dt;
    state.fps += (1 / raw - state.fps) * 0.05;

    applyCamera(dt);
    sim.frame(dt);
    if (dragMode !== 'orbit' && dragMode !== 'pan') pick();
    tools.update(dt, cursor, camRight);
    particles.update(dt);
    world.update(dt, sim.time);
    particles.uLight.value.copy(world.light);

    // son : niveaux tirés de la simulation
    const ka = 1 - Math.exp(-10 * dt);
    audio.water += (particles.landedWater / dt - audio.water) * ka;
    audio.sand += (particles.landedSand / dt - audio.sand) * ka;
    sound.update({
      surf: sim.foamSum / (sim.N * sim.N * 0.05),
      swell: sim.swell,
      wind: sim.wind,
      gust: world.state.gust,
      water: audio.water,
      sand: audio.sand,
    });

    const c = tools.cursor;
    const cu = U.uCursor.value;
    if (c && tools.current !== 'camera') cu.set(c.x, c.z, tools.radius, 1);
    else cu.w = 0;
    // ombre portée de l'outil tenu
    if (!tools.shadowShape(U.uToolA.value, U.uToolB.value, U.uTool2.value)) {
      U.uToolA.value.w = 0;
      U.uTool2.value.w = 0;
    }
    const st = tools.status();
    if (st !== lastStatus) statusEl.textContent = lastStatus = st;

    world.sky.position.copy(camera.position);
    // passe 1 : la scène sans l'eau (sert à la réfraction)
    for (const m of world.water) m.visible = false;
    particles.points.visible = false;
    const cw = cu.w;
    cu.w = 0;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    // passe 2 : image finale
    for (const m of world.water) m.visible = true;
    particles.points.visible = true;
    cu.w = cw;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);

    // qualité adaptative : si l'appareil peine, on baisse la résolution
    if (raw > 1 / 38) slow++;
    else slow = Math.max(0, slow - 2);
    if (slow > 90 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio * 0.8);
      slow = 0;
      resize();
    }
  }
  requestAnimationFrame(frame);

  window.__dune = { sim, tools, world, particles, sound, cam: camT, camera, state, renderer, selectTool, setSetting, save };
}

try {
  start();
} catch (e) {
  console.error(e);
  fatal('Une erreur est survenue au démarrage : ' + e.message);
}
