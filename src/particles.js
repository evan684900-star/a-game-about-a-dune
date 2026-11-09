// Particules balistiques (sable jeté, eau versée).
// Chute libre sous g = 9,81 m/s² avec traînée ; à l'impact, le volume porté
// par la particule est rendu à la simulation (rien ne se perd).
import * as THREE from '../vendor/three.module.min.js';
import { PARTICLE_VERT, PARTICLE_FRAG } from './shaders.js';
import { G } from './waves.js';

const MAX = 4000;

export class Particles {
  constructor(scene, sim) {
    this.sim = sim;
    this.n = 0;
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX); // 0 sable, 1 eau, 2 éclaboussure (visuel)
    this.vol = new Float32Array(MAX);
    this.moist = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.uScale = { value: 800 };
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uScale: this.uScale },
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
      if (kind === 0) this.sim.addSand(x, z, vol, moist, 0.12);
      else if (kind === 1) this.sim.addWater(x, z, vol, 0.15);
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
    this.life[i] = kind === 2 ? 0.35 + Math.random() * 0.25 : 6;
    const r = Math.random();
    if (kind === 0) {
      const d = 1 - 0.55 * Math.min(1, moist * 1.4);
      this.col[i * 4] = (0.95 + r * 0.25) * d;
      this.col[i * 4 + 1] = (0.74 + r * 0.2) * d;
      this.col[i * 4 + 2] = (0.46 + r * 0.14) * d;
      this.col[i * 4 + 3] = 1;
      this.size[i] = 0.035 + r * 0.035;
    } else {
      this.col[i * 4] = 0.75;
      this.col[i * 4 + 1] = 0.95;
      this.col[i * 4 + 2] = 1.15;
      this.col[i * 4 + 3] = kind === 1 ? 0.55 : 0.4;
      this.size[i] = kind === 1 ? 0.05 + r * 0.04 : 0.025 + r * 0.02;
    }
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
      this.kind[i] = this.kind[j];
      this.vol[i] = this.vol[j];
      this.moist[i] = this.moist[j];
      this.life[i] = this.life[j];
    }
  }

  update(dt) {
    const { pos, vel, sim } = this;
    const drag = Math.exp(-0.6 * dt);
    for (let i = this.n - 1; i >= 0; i--) {
      const a = i * 3;
      vel[a + 1] -= G * dt;
      vel[a] *= drag;
      vel[a + 2] *= drag;
      pos[a] += vel[a] * dt;
      pos[a + 1] += vel[a + 1] * dt;
      pos[a + 2] += vel[a + 2] * dt;
      this.life[i] -= dt;
      const x = pos[a],
        z = pos[a + 2];
      const kind = this.kind[i];
      const sand = sim.heightAt(x, z);
      const wat = sim.waterAt(x, z);
      const ground = kind === 0 ? sand + (wat > 0.03 ? wat * 0.5 : 0) : sand + wat;
      if (pos[a + 1] <= ground || this.life[i] <= 0) {
        if (kind === 0) {
          sim.addSand(x, z, this.vol[i], this.moist[i], 0.13);
          if (wat > 0.03 && Math.random() < 0.3) this.splash(x, sand + wat, z, 1);
        } else if (kind === 1) {
          sim.addWater(x, z, this.vol[i], 0.16);
          if (Math.random() < 0.35) this.splash(x, ground, z, 1);
        }
        this.kill(i);
      }
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }

  splash(x, y, z, count) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * 6.283,
        sp = 0.3 + Math.random() * 0.7;
      this.spawn(2, x, y + 0.01, z, Math.cos(a) * sp, 0.8 + Math.random() * 1.2, Math.sin(a) * sp, 0, 0);
    }
  }
}
