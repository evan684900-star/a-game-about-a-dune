// A Game About a Dune — boucle principale, caméra, entrées, interface.
import * as THREE from '../vendor/three.module.min.js';
import { Sim } from './sim.js';
import { makeSwell, makeDetail } from './waves.js';
import { createWorld } from './world.js';
import { Particles } from './particles.js';
import { Tools } from './tools.js';

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

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 9000);
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
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
  function selectTool(name) {
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
    const k = { 1: 'camera', 2: 'shovel', 3: 'bucket', 4: 'water' }[e.key];
    if (k) selectTool(k);
    if (e.key === 'Escape') toggleHelp(false);
    const step = 0.08;
    if (e.key === 'ArrowLeft') camT.az -= step;
    if (e.key === 'ArrowRight') camT.az += step;
    if (e.key === 'ArrowUp') camT.pol = Math.max(0.18, camT.pol - step);
    if (e.key === 'ArrowDown') camT.pol = Math.min(1.5, camT.pol + step);
  });
  $('#swell').addEventListener('input', (e) => (sim.swell = +e.target.value));
  $('#sun').addEventListener('input', (e) => (sim.sun = +e.target.value));
  $('#reset').addEventListener('click', () => sim.reset());
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

    const c = tools.cursor;
    const cu = U.uCursor.value;
    if (c && tools.current !== 'camera') cu.set(c.x, c.z, tools.radius, 1);
    else cu.w = 0;
    // ombre portée de l'outil tenu
    const tg = tools.activeGroup();
    if (tg) U.uTool.value.set(tg.position.x, tg.position.y + tools.shadowLift, tg.position.z, tools.shadowRadius);
    else U.uTool.value.w = 0;
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

  window.__dune = { sim, tools, cam: camT, camera, state, renderer, selectTool };
}

try {
  start();
} catch (e) {
  console.error(e);
  fatal('Une erreur est survenue au démarrage : ' + e.message);
}
