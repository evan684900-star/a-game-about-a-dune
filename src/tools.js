// Outils : pelle, seau, eau. Modèles 3D + logique d'interaction.
import * as THREE from '../vendor/three.module.min.js';

const SHOVEL_R = 0.3;
const SHOVEL_DEPTH = 0.13;
const BUCKET_R = 0.33; // rayon de l'ouverture
const BUCKET_RB = 0.25; // rayon du fond
const BUCKET_H = 0.42;
const BUCKET_VOL = ((Math.PI * BUCKET_H) / 3) * (BUCKET_R * BUCKET_R + BUCKET_R * BUCKET_RB + BUCKET_RB * BUCKET_RB);
const WATER_RATE = 0.012; // m³/s
const SAND_P = 1.2e-4; // volume d'une particule de sable
const WATER_P = 6e-5;

const SAND_DRY = new THREE.Color(0xdcb87a);
const SAND_WET = new THREE.Color(0x7a5f3c);
const WATER_COL = new THREE.Color(0x3fb6c9);

const damp = (cur, tgt, k, dt) => cur + (tgt - cur) * (1 - Math.exp(-k * dt));

function buildShovel() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const metal = new THREE.MeshStandardMaterial({ color: 0xaab2bb, roughness: 0.35, metalness: 0.85 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xb07a43, roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd8322a, roughness: 0.5 });
  // lame légèrement galbée, pointe arrondie
  const bg = new THREE.PlaneGeometry(0.27, 0.32, 8, 8);
  const p = bg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i);
    const t = (0.16 - y) / 0.32; // 0 en haut, 1 à la pointe
    const taper = 1 - 0.55 * t * t * t;
    p.setX(i, x * taper);
    p.setZ(i, -(x * x) * 2.2 + t * 0.02);
    p.setY(i, y + 0.16 + (1 - Math.cos((x / 0.135) * 1.2)) * 0.03 * t);
  }
  bg.computeVertexNormals();
  const blade = new THREE.Mesh(bg, metal);
  blade.material.side = THREE.DoubleSide;
  g.add(blade);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.14, 10), metal);
  socket.position.set(0, 0.36, 0.0);
  g.add(socket);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.85, 10), wood);
  handle.position.set(0, 0.8, 0);
  g.add(handle);
  const grip = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 8, 20), red);
  grip.position.set(0, 1.28, 0);
  g.add(grip);
  const sandMat = new THREE.MeshStandardMaterial({ color: SAND_DRY, roughness: 1 });
  const mound = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), sandMat);
  mound.scale.set(0.95, 1.1, 0.42);
  mound.position.set(0, 0.17, -0.035);
  mound.visible = false;
  g.add(mound);
  return { group: g, mound, sandMat };
}

function buildBucket() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const h = BUCKET_H / 2;
  const pts = [
    [0, -h],
    [BUCKET_RB, -h],
    [BUCKET_R, h],
    [BUCKET_R + 0.018, h],
    [BUCKET_R + 0.018, h + 0.016],
    [BUCKET_R - 0.014, h + 0.016],
    [BUCKET_RB - 0.012, -h + 0.014],
    [0, -h + 0.014],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const plastic = new THREE.MeshStandardMaterial({ color: 0xf2b21c, roughness: 0.45, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 36), plastic));
  const hm = new THREE.MeshStandardMaterial({ color: 0x2a6fd6, roughness: 0.4 });
  const handle = new THREE.Mesh(new THREE.TorusGeometry(BUCKET_R + 0.012, 0.011, 6, 28, Math.PI), hm);
  handle.position.y = h - 0.01;
  handle.rotation.x = 0.5;
  g.add(handle);
  const contentMat = new THREE.MeshStandardMaterial({ color: SAND_DRY, roughness: 1 });
  const content = new THREE.Mesh(new THREE.CircleGeometry(BUCKET_R - 0.03, 28).rotateX(-Math.PI / 2), contentMat);
  content.position.y = h - 0.045;
  content.visible = false;
  g.add(content);
  const rim = new THREE.Object3D();
  rim.position.set(0, h, BUCKET_R - 0.03);
  g.add(rim);
  return { group: g, content, contentMat, rim };
}

function buildCan() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const green = new THREE.MeshStandardMaterial({ color: 0x2f9e6b, roughness: 0.45, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.27, 24), green);
  g.add(body);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.035, 0.42, 12), green);
  spout.position.set(0, 0.06, 0.29);
  spout.rotation.x = 0.95;
  g.add(spout);
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.025, 0.05, 14), green);
  rose.position.set(0, 0.19, 0.47);
  rose.rotation.x = 0.95;
  g.add(rose);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.014, 8, 20, Math.PI * 1.1), green);
  handle.position.set(0, 0.03, -0.15);
  handle.rotation.set(0, Math.PI / 2, -Math.PI / 2 - 0.15);
  g.add(handle);
  const nozzle = new THREE.Object3D();
  nozzle.position.set(0, 0.2, 0.5);
  g.add(nozzle);
  return { group: g, nozzle };
}

export class Tools {
  constructor(scene, sim, particles) {
    this.sim = sim;
    this.particles = particles;
    this.current = 'shovel';
    this.cursor = null;
    this.anchor = new THREE.Vector3(0, 1, 0);
    this.busy = 0;
    this.events = [];
    this.emit = null;
    this.down = false;
    this.right = new THREE.Vector3(1, 0, 0);
    this.onEvent = () => {}; // (nom, donnée) : sons, sauvegarde

    this.shovel = { ...buildShovel(), load: 0, moist: 0, lean: 0.6, leanT: 0.6, h: 0.35, hT: 0.35 };
    this.bucket = { ...buildBucket(), kind: null, vol: 0, moist: 0, flip: 0, flipT: 0, h: 0.5, hT: 0.5, side: 0, sideT: 0 };
    this.can = { ...buildCan(), tilt: 0, tiltT: 0, acc: 0 };
    for (const t of [this.shovel, this.bucket, this.can]) {
      t.group.visible = false;
      scene.add(t.group);
    }
    this.v = new THREE.Vector3();
  }

  setTool(name) {
    if (this.busy > 0) return false;
    this.current = name;
    this.down = false;
    return true;
  }

  get radius() {
    if (this.current === 'shovel') return SHOVEL_R;
    if (this.current === 'bucket') return this.bucket.kind === 'sand' ? BUCKET_R : 0.4;
    if (this.current === 'water') return 0.2;
    return 0;
  }

  activeGroup() {
    const t = { shovel: this.shovel, bucket: this.bucket, water: this.can }[this.current];
    return t && t.group.visible ? t.group : null;
  }
  // forme de l'ombre portée de l'outil tenu : une capsule [A,B] + une sphère
  shadowShape(A, B, S) {
    const g = this.activeGroup();
    if (!g) return false;
    g.updateMatrixWorld(true);
    const v = this.v;
    const put = (x, y, z) => g.localToWorld(v.set(x, y, z));
    if (this.current === 'shovel') {
      put(0, 0.34, 0);
      A.set(v.x, v.y, v.z, 0.024);
      B.copy(put(0, 1.28, 0));
      put(0, 0.16, 0);
      S.set(v.x, v.y, v.z, this.shovel.load > 0 ? 0.14 : 0.115);
    } else if (this.current === 'bucket') {
      put(0, -0.07, 0);
      A.set(v.x, v.y, v.z, 0.27);
      B.copy(put(0, 0.07, 0));
      S.w = 0;
    } else {
      put(0, 0.03, 0.15);
      A.set(v.x, v.y, v.z, 0.03);
      B.copy(put(0, 0.2, 0.5));
      put(0, 0, 0);
      S.set(v.x, v.y, v.z, 0.185);
    }
    return true;
  }

  status() {
    if (this.current === 'shovel')
      return this.shovel.load > 0 ? 'Pelle chargée — clique pour verser le sable' : 'Pelle vide — clique pour creuser';
    if (this.current === 'bucket') {
      const b = this.bucket;
      if (b.kind === 'sand')
        return `Seau plein de sable ${b.moist > 0.25 ? (b.moist > 0.85 ? 'détrempé' : 'humide') : 'sec'} — clique pour démouler`;
      if (b.kind === 'water') return 'Seau plein d’eau — clique pour verser';
      return 'Seau vide — clique sur le sable ou dans l’eau pour le remplir';
    }
    if (this.current === 'water') return 'Eau — maintiens appuyé pour verser';
    return 'Caméra — glisse pour tourner, molette / pincement pour zoomer';
  }

  at(delay, fn) {
    this.events.push({ t: delay, fn });
  }

  onDown() {
    this.down = true;
    if (this.busy > 0 || !this.cursor) return;
    const c = this.cursor;
    const sim = this.sim;
    if (this.current === 'shovel') {
      const s = this.shovel;
      if (s.load <= 0) {
        this.busy = 0.5;
        s.hT = -0.2;
        s.leanT = 0.2;
        this.at(0.17, () => {
          const r = sim.dig(c.x, c.z, SHOVEL_R, SHOVEL_DEPTH);
          this.onEvent('dig', r.moist);
          s.load = r.vol;
          s.moist = r.moist;
          s.mound.visible = r.vol > 1e-4;
          s.sandMat.color.copy(SAND_DRY).lerp(SAND_WET, Math.min(1, r.moist * 1.4));
          s.hT = 0.35;
          s.leanT = r.vol > 1e-4 ? 1.2 : 0.6;
        });
      } else {
        this.busy = 0.75;
        s.leanT = -0.35;
        this.at(0.15, () => {
          this.emit = { kind: 0, vol: s.load, rate: s.load / 0.35, moist: s.moist, src: s.mound, vel: [0, 0.2, 0], spread: 0.5 };
        });
        this.at(0.5, () => {
          s.load = 0;
          s.mound.visible = false;
        });
        this.at(0.6, () => {
          s.leanT = 0.6;
        });
      }
    } else if (this.current === 'bucket') {
      const b = this.bucket;
      if (!b.kind) {
        const inWater = sim.waterAt(c.x, c.z) > 0.04;
        this.busy = 0.6;
        b.hT = BUCKET_H * 0.3;
        b.sideT = inWater ? 1.2 : 0.9;
        this.at(0.22, () => {
          if (inWater) {
            b.vol = sim.takeWater(c.x, c.z, 0.5, BUCKET_VOL);
            this.onEvent('scoop', 1);
            b.kind = b.vol > 1e-3 ? 'water' : null;
            b.contentMat.color.copy(WATER_COL);
            b.contentMat.roughness = 0.1;
          } else {
            const r = sim.dig(c.x, c.z, 0.4, 0.5, BUCKET_VOL);
            this.onEvent('dig', r.moist);
            b.vol = r.vol;
            b.moist = r.moist;
            b.kind = r.vol > 1e-3 ? 'sand' : null;
            b.contentMat.color.copy(SAND_DRY).lerp(SAND_WET, Math.min(1, r.moist * 1.4));
            b.contentMat.roughness = 1;
          }
          b.content.visible = !!b.kind;
          b.content.scale.setScalar(0.75 + 0.25 * Math.min(1, b.vol / BUCKET_VOL));
          b.content.position.y = BUCKET_H / 2 - 0.045 - 0.2 * (1 - Math.min(1, b.vol / BUCKET_VOL));
          b.hT = 0.5;
          b.sideT = 0;
        });
      } else if (b.kind === 'sand') {
        // retourner le seau et démouler
        this.busy = 1.0;
        b.flipT = 1;
        b.hT = BUCKET_H / 2 + 0.02;
        this.at(0.38, () => {
          sim.stamp(c.x, c.z, BUCKET_R, BUCKET_RB, BUCKET_H, b.vol, b.moist);
          this.onEvent('stamp', b.moist);
          b.kind = null;
          b.vol = 0;
          b.content.visible = false;
        });
        this.at(0.5, () => {
          b.hT = 0.75;
        });
        this.at(0.78, () => {
          b.flipT = 0;
          b.hT = 0.5;
        });
      } else {
        this.busy = 1.55;
        b.sideT = 1.75;
        this.at(0.2, () => {
          this.emit = { kind: 1, vol: b.vol, rate: b.vol / 1.0, moist: 1, src: b.rim, vel: [0.9, 0.1, 0], spread: 0.35, pv: b.vol / 480 };
        });
        this.at(1.25, () => {
          b.kind = null;
          b.vol = 0;
          b.content.visible = false;
          b.sideT = 0;
        });
      }
    }
  }

  onUp() {
    this.down = false;
  }

  update(dt, cursor, camRight) {
    const sim = this.sim;
    // curseur limité à la zone jouable
    const lim = sim.L / 2 - 1.9;
    this.cursor = cursor && Math.abs(cursor.x) < lim && Math.abs(cursor.z) < lim ? cursor : null;
    this.right.copy(camRight);
    const yaw = Math.atan2(camRight.x, camRight.z);

    // chronologie des animations
    if (this.busy > 0) this.busy -= dt;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      e.t -= dt;
      if (e.t <= 0) {
        this.events.splice(i, 1);
        e.fn();
      }
    }
    // l'outil suit le curseur (sauf pendant une action)
    if (this.cursor && this.busy <= 0) this.anchor.set(this.cursor.x, this.cursor.y, this.cursor.z);
    else if (this.busy > 0) this.anchor.y = sim.heightAt(this.anchor.x, this.anchor.z);
    const a = this.anchor;
    const show = this.current !== 'camera' && (this.cursor || this.busy > 0);

    const s = this.shovel,
      b = this.bucket,
      c = this.can;
    s.group.visible = show && this.current === 'shovel';
    b.group.visible = show && this.current === 'bucket';
    c.group.visible = show && this.current === 'water';

    if (this.current === 'shovel') {
      s.lean = damp(s.lean, s.leanT, 16, dt);
      s.h = damp(s.h, s.hT, 18, dt);
      s.group.rotation.set(s.lean, yaw, 0);
      // la pointe de la lame vise le curseur
      const back = s.lean > 0.9 ? 0.16 : 0;
      s.group.position.set(a.x - camRight.x * back, a.y + s.h, a.z - camRight.z * back);
    } else if (this.current === 'bucket') {
      b.flip = damp(b.flip, b.flipT, 14, dt);
      b.side = damp(b.side, b.sideT, 12, dt);
      b.h = damp(b.h, b.hT, 16, dt);
      b.group.rotation.set(b.flip * Math.PI + b.side, yaw, 0);
      const off = b.kind === 'water' && b.sideT > 1.5 ? 0.45 : 0;
      b.group.position.set(a.x - camRight.x * off, a.y + b.h + (off ? 0.25 : 0), a.z - camRight.z * off);
    } else if (this.current === 'water') {
      const pouring = this.down && !!this.cursor;
      c.tiltT = pouring ? 0.75 : 0.1;
      c.tilt = damp(c.tilt, c.tiltT, 10, dt);
      c.group.rotation.set(c.tilt, yaw, 0);
      c.group.position.set(a.x - camRight.x * 0.85, a.y + 0.8, a.z - camRight.z * 0.85);
      if (pouring && c.tilt > 0.45) {
        c.acc += WATER_RATE * dt;
        c.group.updateMatrixWorld(true);
        c.nozzle.getWorldPosition(this.v);
        while (c.acc >= WATER_P) {
          c.acc -= WATER_P;
          const j = () => (Math.random() - 0.5) * 0.35;
          const sp = 1.15 + Math.random() * 0.3;
          this.particles.spawn(
            1,
            this.v.x + j() * 0.1,
            this.v.y + j() * 0.1,
            this.v.z + j() * 0.1,
            camRight.x * sp + j(),
            -0.5 + j(),
            camRight.z * sp + j(),
            WATER_P,
            1
          );
        }
      }
    }

    // émission progressive (pelle qui verse, seau qui se vide)
    const e = this.emit;
    if (e) {
      let out = Math.min(e.vol, e.rate * dt);
      e.vol -= out;
      const pv = e.pv || (e.kind === 0 ? SAND_P : WATER_P);
      e.src.getWorldPosition(this.v);
      e.acc = (e.acc || 0) + out;
      while (e.acc >= pv || (e.vol <= 1e-9 && e.acc > 1e-9)) {
        const vol = Math.min(pv, e.acc);
        e.acc -= vol;
        const j = () => (Math.random() - 0.5) * e.spread;
        this.particles.spawn(
          e.kind,
          this.v.x + j() * 0.3,
          this.v.y + j() * 0.15,
          this.v.z + j() * 0.3,
          camRight.x * e.vel[0] + j(),
          e.vel[1] + j() * 0.5,
          camRight.z * e.vel[0] + j(),
          vol,
          e.moist
        );
        if (e.acc <= 1e-9) break;
      }
      if (e.vol <= 1e-9 && e.acc <= 1e-9) this.emit = null;
    }
  }
}
