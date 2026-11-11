// Son entièrement synthétisé (Web Audio), sans aucun fichier.
// Les niveaux sont pilotés par la simulation : le ressac suit l'énergie de
// déferlement réelle, le vent suit sa vitesse, l'eau et le sable suivent les
// volumes qui touchent le sol.

function noiseBuffer(ctx, seconds, kind) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w * 0.5;
    else if (kind === 'pink') {
      // filtre de Paul Kellet (version économique) : -3 dB/octave
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
    } else {
      // bruit brun : marche aléatoire amortie, -6 dB/octave
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
  }
  // raccord de boucle sans clic : fondu de la fin vers le début
  const f = Math.floor(ctx.sampleRate * 0.25);
  for (let i = 0; i < f; i++) {
    const k = i / f;
    d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k;
  }
  return buf;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('dune-muted') === '1';
    } catch (e) {}
  }

  // à appeler depuis un geste de l'utilisateur (règle d'autoplay des navigateurs)
  start() {
    if (this.muted) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try {
      ctx = new AC();
    } catch (e) {
      return;
    }
    this.ctx = ctx;
    const master = (this.master = ctx.createGain());
    master.gain.value = 0;
    master.gain.setTargetAtTime(0.7, ctx.currentTime, 0.6);
    master.connect(ctx.destination);
    this.white = noiseBuffer(ctx, 2.5, 'white');
    const pink = noiseBuffer(ctx, 4, 'pink');
    const brown = noiseBuffer(ctx, 4, 'brown');

    const layer = (buf, type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = type;
      filt.frequency.value = freq;
      filt.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filt).connect(gain).connect(master);
      src.start(0, Math.random() * 2);
      return { filt, gain };
    };
    this.surf = layer(pink, 'lowpass', 700, 0.4);
    this.rumble = layer(brown, 'lowpass', 170, 0.5);
    this.wind = layer(pink, 'bandpass', 420, 0.7);
    this.hiss = layer(this.white, 'highpass', 3800, 0.5);
    this.pour = layer(this.white, 'bandpass', 1700, 1.1);
    this.sand = layer(this.white, 'highpass', 4500, 0.5);
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('dune-muted', m ? '1' : '0');
    } catch (e) {}
    if (m) {
      if (this.ctx) this.ctx.suspend();
    } else this.start();
  }

  pause(hidden) {
    if (!this.ctx || this.muted) return;
    if (hidden) this.ctx.suspend();
    else this.ctx.resume();
  }

  // lv : { surf 0..1, swell, wind m/s, gust 0..1, water m³/s, sand m³/s }
  update(lv) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const set = (param, v, tc = 0.12) => param.setTargetAtTime(v, t, tc);
    const s = Math.pow(Math.min(1, lv.surf), 0.8);
    set(this.surf.gain.gain, (0.02 + 0.3 * s) * Math.min(1, 0.25 + lv.swell), 0.25);
    set(this.surf.filt.frequency, 420 + 2400 * s, 0.25);
    set(this.rumble.gain.gain, 0.04 + 0.1 * Math.min(2, lv.swell), 0.5);
    const w = Math.min(1, lv.wind / 15);
    set(this.wind.gain.gain, 0.55 * w * w * (0.55 + 0.6 * lv.gust), 0.3);
    set(this.wind.filt.frequency, 240 + 520 * w + 160 * lv.gust, 0.3);
    set(this.hiss.gain.gain, Math.max(0, (lv.wind * 1.35 - 6) / 14) * 0.1 * (0.6 + 0.5 * lv.gust), 0.3);
    set(this.pour.gain.gain, lv.water > 1e-4 ? Math.min(0.36, 0.08 + lv.water * 9) : 0, 0.06);
    set(this.pour.filt.frequency, 1300 + Math.random() * 1100, 0.04);
    set(this.sand.gain.gain, Math.min(0.26, lv.sand * 5), 0.05);
  }

  burst(type, f0, f1, dur, gain, q = 0.9) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t, Math.random() * 2, dur + 0.05);
  }

  // coup de pelle : plus sourd dans le sable mouillé
  dig(moist) {
    const wet = Math.min(1, moist * 1.5);
    this.burst('bandpass', 1900 - 1200 * wet, 800 - 500 * wet, 0.24, 0.5);
  }

  // démoulage : choc sourd + souffle bref
  stamp() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
    this.burst('lowpass', 900, 300, 0.14, 0.35, 0.5);
  }

  // truelle qui racle
  scrape(moist) {
    const wet = Math.min(1, moist * 1.5);
    this.burst('bandpass', 2600 - 1400 * wet, 1500 - 800 * wet, 0.16, 0.22, 1.2);
  }

  // main qui tapote le sable
  pat() {
    this.burst('lowpass', 500, 180, 0.09, 0.3, 0.6);
  }

  // seau plongé dans l'eau
  scoop() {
    this.burst('bandpass', 500, 2400, 0.3, 0.4, 1.4);
  }
}
