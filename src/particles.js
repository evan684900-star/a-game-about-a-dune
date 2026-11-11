// Particules : sable jeté, eau versée, éclaboussures, sable soufflé par le vent.
// Chute libre sous g = 9,81 m/s² avec traînée ; à l'impact, le volume porté
// par la particule est rendu à la simulation (rien ne se perd).
import * as THREE from '../vendor/three.module.min.js';
import { PARTICLE_VERT, PARTICLE_FRAG } from './shaders.js';
import { G } from './waves.js';
import { WIND_T } from './sim.js';

const MAX = 5000;
export const SAND = 0,
  WATER = 1,
  SPLASH = 2,
  DRIFT = 3;

export class Particles {
  constructor(scene, sim) {
    this.sim = sim;
    this.n = 0;
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    this.stretch = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX);
    this.vol = new Float32Array(MAX);
    this.moist = new Float32Array(MAX); // (sable soufflé : opacité de base)
    this.life = new Float32Array(MAX);
    this.life0 = new Float32Array(MAX);
    // volumes arrivés au sol pendant la dernière image (pilotent le son)
    this.landedSand = 0;
    this.landedWater = 0;
    this.driftAcc = 0;
    const g = new THREE.BufferGeometry();
    const attr = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', attr(this.pos, 3));
    g.setAttribute('aVel', attr(this.vel, 3));
    g.setAttribute('aColor', attr(this.col, 4));
    g.setAttribute('aSize', attr(this.size, 1));
    g.setAttribute('aStretch', attr(this.stretch, 1));
    this.geo = g;
    this.uScale = { value: 800 };
    this.uHalfRes = { value: new THREE.Vector2(400, 300) };
    this.uLight = { value: new THREE.Vector3(1, 1, 1) };
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uScale: this.uScale, uHalfRes: this.uHalfRes, uLight: this.uLight },
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        transparent: true,
        depthWrite: false,
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    g.setDrawRange(0, 0);
  }

  spawn(kind, x, y, z, vx, vy, vz, vol, moist) {
    if (this.n >= MAX) {
      // réservoir plein : dépôt immédiat pour conserver le volume
      if (kind === SAND) this.sim.addSand(x, z, vol, moist, 0.12);
      else if (kind === WATER) this.sim.addWater(x, z, vol, 0.15);
      return;
    }
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.kind[i] = kind;
    this.vol[i] = vol;
    this.moist[i] = moist;
    const r = Math.random();
    const c = i * 4;
    if (kind === SAND) {
      const d = 1 - 0.55 * Math.min(1, moist * 3.3);
      this.col[c] = (0.74 + r * 0.2) * d;
      this.col[c + 1] = (0.55 + r * 0.15) * d;
      this.col[c + 2] = (0.31 + r * 0.1) * d;
      this.col[c + 3] = 1;
      this.size[i] = 0.032 + r * 0.034;
      this.stretch[i] = 0.25;
      this.life[i] = 6;
    } else if (kind === DRIFT) {
      this.col[c] = 0.98;
      this.col[c + 1] = 0.8;
      this.col[c + 2] = 0.54;
      this.col[c + 3] = 0;
      this.size[i] = 0.02 + r * 0.03;
      this.stretch[i] = 2.2;
      this.life[i] = 0.5 + r * 0.9;
    } else {
      this.col[c] = 0.5;
      this.col[c + 1] = 0.64;
      this.col[c + 2] = 0.74;
      this.col[c + 3] = kind === WATER ? 0.72 : 0.5;
      this.size[i] = kind === WATER ? 0.02 + r * 0.02 : 0.014 + r * 0.016;
      this.stretch[i] = kind === WATER ? 1 : 0.6;
      this.life[i] = kind === WATER ? 6 : 0.3 + r * 0.3;
    }
    this.life0[i] = this.life[i];
  }

  kill(i) {
    const j = --this.n;
    if (i !== j) {
      for (let k = 0; k < 3; k++) {
        this.pos[i * 3 + k] = this.pos[j * 3 + k];
        this.vel[i * 3 + k] = this.vel[j * 3 + k];
      }
      for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[j * 4 + k];
      this.size[i] = this.size[j];
      this.stretch[i] = this.stretch[j];
      this.kind[i] = this.kind[j];
      this.vol[i] = this.vol[j];
      this.moist[i] = this.moist[j];
      this.life[i] = this.life[j];
      this.life0[i] = this.life0[j];
    }
  }

  // voiles de sable arrachés par le vent au-dessus du seuil de saltation
  drift(dt) {
    const sim = this.sim;
    const U = sim.wind;
    const over = U * 1.35 - WIND_T;
    if (over <= 0) return;
    this.driftAcc += Math.min(900, over * 110) * dt;
    let tries = 0;
    while (this.driftAcc >= 1 && tries++ < 60) {
      this.driftAcc -= 1;
      const a = Math.random() * 6.283,
        rr = Math.sqrt(Math.random()) * 8.5;
      const x = Math.cos(a) * rr,
        z = Math.sin(a) * rr;
      if (sim.waterAt(x, z) > 1e-3 || sim.moistAt(x, z) > 0.18) continue;
      const h = sim.heightAt(x, z);
      if (h < 0.15) continue;
      const sp = U * (0.3 + Math.random() * 0.25);
      this.spawn(DRIFT, x, h + 0.02, z, sp, 0, (Math.random() - 0.5) * 0.6, 0, 0.22 + Math.random() * 0.3);
    }
    if (this.driftAcc > 4) this.driftAcc = 4;
  }

  update(dt) {
    const { pos, vel, sim } = this;
    this.landedSand = 0;
    this.landedWater = 0;
    this.drift(dt);
    const drag = Math.exp(-0.6 * dt);
    for (let i = this.n - 1; i >= 0; i--) {
      const a = i * 3;
      const kind = this.kind[i];
      this.life[i] -= dt;
      if (kind === DRIFT) {
        // saltation : petits bonds au ras du sol, portés par le vent
        pos[a] += vel[a] * dt;
        pos[a + 2] += vel[a + 2] * dt;
        const x = pos[a],
          z = pos[a + 2];
        const life = this.life[i],
          l0 = this.life0[i];
        const gy = sim.heightAt(x, z);
        const y = gy + 0.015 + 0.07 * Math.abs(Math.sin((l0 - life) * 7 + l0 * 40));
        vel[a + 1] = (y - pos[a + 1]) / Math.max(dt, 1e-3);
        pos[a + 1] = y;
        this.col[i * 4 + 3] = this.moist[i] * Math.min(1, life * 4) * Math.min(1, (l0 - life) * 6);
        if (life <= 0 || sim.waterAt(x, z) > 2e-3 || gy < 0.05) this.kill(i);
        continue;
      }
      vel[a + 1] -= G * dt;
      vel[a] *= drag;
      vel[a + 2] *= drag;
      pos[a] += vel[a] * dt;
      pos[a + 1] += vel[a + 1] * dt;
      pos[a + 2] += vel[a + 2] * dt;
      const x = pos[a],
        z = pos[a + 2];
      const sand = sim.heightAt(x, z);
      const wat = sim.waterAt(x, z);
      const ground = kind === SAND ? sand + (wat > 0.03 ? wat * 0.5 : 0) : sand + wat;
      if (pos[a + 1] <= ground || this.life[i] <= 0) {
        if (kind === SAND) {
          sim.addSand(x, z, this.vol[i], this.moist[i], 0.13);
          this.landedSand += this.vol[i];
          if (wat > 0.03 && Math.random() < 0.3) this.splash(x, sand + wat, z, 1);
        } else if (kind === WATER) {
          // jet rapide : l'eau garde son élan et creuse à l'impact
          if (vel[a] * vel[a] + vel[a + 2] * vel[a + 2] > 4) sim.jet(x, z, this.vol[i], vel[a], vel[a + 2]);
          else sim.addWater(x, z, this.vol[i], 0.16);
          this.landedWater += this.vol[i];
          if (Math.random() < 0.3) this.splash(x, ground, z, 1);
        }
        this.kill(i);
      }
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'aVel', 'aColor', 'aSize', 'aStretch']) this.geo.attributes[k].needsUpdate = true;
  }

  splash(x, y, z, count) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * 6.283,
        sp = 0.3 + Math.random() * 0.7;
      this.spawn(SPLASH, x, y + 0.01, z, Math.cos(a) * sp, 0.8 + Math.random() * 1.2, Math.sin(a) * sp, 0, 0);
    }
  }

  clear() {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }
}
