/**
 * Synthesized audio (WebAudio only, no files needed):
 *  - a sound kit for a powered suit: repulsors, thrusters, servos, HUD blips, missiles, impacts
 *  - an original electronic score (written for this site): a theme per chapter built from a pulsing bass,
 *    an arpeggiator, a detuned pad, a lead and a drum machine, with a "battle" mood that takes over for a while
 *  - optional: audio files you have the rights to, listed in public/music/tracks.json as
 *    { "<chapter-id>": "file.mp3" }, play for that chapter in place of the score
 */

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixo: [0, 2, 4, 5, 7, 9, 10],
};
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const degMidi = (th, deg, oct = 0) => {
  const sc = SCALES[th.scale];
  const n = sc.length;
  const o = Math.floor(deg / n);
  const d = ((deg % n) + n) % n;
  return th.root + sc[d] + 12 * (o + oct);
};
const note = (th, deg, oct = 0) => mtof(degMidi(th, deg, oct));

/*
 * Each theme loops 8 bars of 16 steps. `prog`: the chord root (scale degree) per bar. `kick`, `snare`, `hat`:
 * 16-step patterns (1 = hit, 0.5 = ghost). `arp`: chord-tone index per step (null = rest). `lead`: [degree,
 * steps] pairs across the 8 bars (null = rest). `bass`: steps the bass plays on. `pad`, `arpVel`, `leadVel`:
 * levels. `cut`: filter brightness 0..1.
 */
const X = null;
const THEMES = {
  // the arc reactor hums awake: slow, wide, heroic
  prologue: {
    bpm: 92, root: 45, scale: 'dorian', prog: [0, 5, 3, 4, 0, 5, 6, 4],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0],
    arp: [0, X, 1, X, 2, X, 1, X, 0, X, 1, X, 2, X, 3, X], arpVel: 0.05,
    lead: [[4, 8], [3, 8], [2, 16], [4, 8], [5, 8], [6, 12], [5, 4], [4, 16], [X, 16], [2, 8], [3, 8], [4, 16]], leadVel: 0.05,
    bass: [0, 6, 8, 14], pad: 0.05, cut: 0.45,
  },
  // a cave, scrap metal, a man building to survive: dark, mechanical
  cave: {
    bpm: 84, root: 40, scale: 'phrygian', prog: [0, 0, 1, 0, 0, 0, 6, 5],
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.5], hat: [0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0],
    arp: [0, X, X, 0, X, X, 1, X, 0, X, X, 0, X, 2, X, X], arpVel: 0.045,
    lead: [[X, 32], [0, 4], [1, 4], [0, 8], [X, 16], [3, 6], [1, 2], [0, 8], [X, 16], [4, 8], [3, 8], [1, 16]], leadVel: 0.035,
    bass: [0, 3, 6, 10, 12], pad: 0.035, cut: 0.3,
  },
  // the workshop: clean, curious, bright synths
  workshop: {
    bpm: 108, root: 48, scale: 'lydian', prog: [0, 4, 5, 3, 0, 4, 1, 4],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0.5],
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3], arpVel: 0.04,
    lead: [[4, 4], [5, 4], [6, 8], [7, 8], [6, 8], [4, 16], [X, 16], [2, 4], [4, 4], [6, 8], [5, 16], [X, 16], [4, 8], [2, 8]], leadVel: 0.035,
    bass: [0, 4, 8, 12], pad: 0.03, cut: 0.7,
  },
  // suit up: driving, building
  suitup: {
    bpm: 118, root: 43, scale: 'minor', prog: [0, 0, 5, 5, 3, 3, 4, 4],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5],
    arp: [0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2, 0, 3, 2, 1], arpVel: 0.045,
    lead: [[0, 8], [2, 8], [4, 16], [5, 8], [4, 8], [2, 16], [0, 8], [2, 8], [4, 8], [7, 8], [6, 16], [4, 16]], leadVel: 0.045,
    bass: [0, 2, 4, 6, 8, 10, 12, 14], pad: 0.03, cut: 0.6,
  },
  // flight: open sky, soaring
  flight: {
    bpm: 124, root: 47, scale: 'mixo', prog: [0, 6, 3, 4, 0, 6, 3, 4],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    arp: [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 4, 2, 1, 3, 5, 3], arpVel: 0.04,
    lead: [[4, 12], [5, 4], [4, 8], [2, 8], [3, 16], [4, 16], [7, 12], [6, 4], [4, 8], [5, 8], [4, 32]], leadVel: 0.05,
    bass: [0, 3, 6, 8, 11, 14], pad: 0.04, cut: 0.75,
  },
  // inside the helmet: tense, analytical
  hud: {
    bpm: 100, root: 45, scale: 'minor', prog: [0, 0, 3, 3, 5, 5, 4, 4],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [1, 1, 0.5, 1, 1, 1, 0.5, 1, 1, 1, 0.5, 1, 1, 1, 0.5, 1],
    arp: [0, X, 0, 1, X, 1, 2, X, 0, X, 0, 1, X, 1, 3, X], arpVel: 0.04,
    lead: [[X, 16], [2, 4], [0, 4], [X, 8], [X, 16], [3, 4], [2, 4], [X, 8], [X, 16], [4, 4], [3, 4], [X, 8], [X, 16], [2, 16]], leadVel: 0.03,
    bass: [0, 2, 8, 10], pad: 0.03, cut: 0.5,
  },
  // the firing range: punchy
  repulsors: {
    bpm: 128, root: 41, scale: 'phrygian', prog: [0, 0, 1, 0, 0, 0, 6, 1],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0, 0], hat: [0.5, 0, 1, 0, 0.5, 0, 1, 0, 0.5, 0, 1, 0, 0.5, 0, 1, 0],
    arp: [0, X, 0, X, 1, X, 0, X, 0, X, 0, X, 2, X, 1, X], arpVel: 0.045,
    lead: [[X, 32], [0, 8], [1, 8], [0, 16], [X, 32], [3, 8], [1, 8], [0, 16]], leadVel: 0.035,
    bass: [0, 2, 4, 6, 8, 10, 12, 14], pad: 0.025, cut: 0.55,
  },
  // the hall of armor: reverent, museum-like
  armory: {
    bpm: 80, root: 48, scale: 'major', prog: [0, 4, 5, 3, 0, 3, 4, 4],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], hat: [0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0],
    arp: [0, X, 2, X, 4, X, 2, X, 0, X, 2, X, 4, X, 7, X], arpVel: 0.04,
    lead: [[4, 16], [5, 8], [4, 8], [2, 16], [1, 16], [2, 8], [4, 8], [5, 16], [4, 32]], leadVel: 0.04,
    bass: [0, 8], pad: 0.05, cut: 0.5,
  },
  // the new element: wonder
  reactor: {
    bpm: 96, root: 50, scale: 'lydian', prog: [0, 1, 0, 1, 5, 4, 1, 0],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0],
    arp: [0, 1, 2, 4, 2, 1, 0, 1, 2, 4, 6, 4, 2, 1, 2, 4], arpVel: 0.04,
    lead: [[X, 16], [4, 8], [6, 8], [7, 16], [X, 16], [6, 8], [4, 8], [5, 16], [X, 16], [4, 32]], leadVel: 0.04,
    bass: [0, 8], pad: 0.05, cut: 0.6,
  },
  // the battle: full drums, heavy bass
  battle: {
    bpm: 140, root: 40, scale: 'minor', prog: [0, 0, 5, 6, 0, 0, 3, 4],
    kick: [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.5], hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    arp: [0, 0, 2, 0, 1, 0, 2, 0, 0, 0, 2, 0, 3, 0, 2, 0], arpVel: 0.045,
    lead: [[0, 4], [2, 4], [4, 8], [3, 8], [2, 8], [0, 16], [4, 4], [5, 4], [7, 8], [6, 8], [4, 8], [3, 16], [X, 8], [2, 8]], leadVel: 0.045,
    bass: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], pad: 0.03, cut: 0.7,
  },
  // a life, looked back on: warm and bittersweet
  timeline: {
    bpm: 76, root: 45, scale: 'major', prog: [0, 5, 3, 4, 0, 5, 1, 4],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], hat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    arp: [0, X, 1, X, 2, X, 1, X, 0, X, 1, X, 2, X, 4, X], arpVel: 0.04,
    lead: [[2, 8], [4, 8], [5, 16], [4, 8], [2, 8], [1, 16], [2, 8], [4, 8], [7, 16], [6, 8], [4, 8], [4, 16]], leadVel: 0.045,
    bass: [0, 8], pad: 0.05, cut: 0.4,
  },
  // the quiz: light and playful
  trials: {
    bpm: 112, root: 50, scale: 'mixo', prog: [0, 3, 4, 3, 0, 3, 6, 4],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    arp: [0, 2, 4, 2, 0, 2, 4, 2, 0, 2, 4, 2, 1, 3, 5, 3], arpVel: 0.035,
    lead: [[X, 32], [4, 4], [5, 4], [4, 8], [X, 16], [2, 4], [4, 4], [5, 8], [X, 16], [7, 8], [4, 24]], leadVel: 0.035,
    bass: [0, 6, 8, 14], pad: 0.03, cut: 0.6,
  },
};
// chapters without their own theme borrow one
const THEME_OF = { armor: 'armory', protege: 'timeline' };
const CHORD = [0, 2, 4, 6, 7];

class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.listeners = new Set();
    this.scene = 'prologue';
    this.mood = 'calm';
    this.moodUntil = 0;
    this._step = 0;
    this._nextTime = 0;
    this._tracks = null;
    this._file = null;
    try {
      const s = JSON.parse(localStorage.getItem('ironman-audio') || '{}');
      if (s.muted) this.muted = true;
      if (s.music === false) this.musicOn = false;
    } catch (_) { /* private mode */ }
  }

  onChange(fn) { this.listeners.add(fn); }
  _emit() {
    try { localStorage.setItem('ironman-audio', JSON.stringify({ muted: this.muted, music: this.musicOn })); } catch (_) { /* private mode */ }
    this.listeners.forEach((fn) => fn());
  }

  /** Browsers only allow audio after a user gesture: call from one. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 1; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicOn ? 0.8 : 0; this.musicBus.connect(this.master);
    // a short room reverb and a tempo delay for the synths
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(2.2, 2.6);
    const rv = ctx.createGain(); rv.gain.value = 0.35; this.reverb.connect(rv).connect(this.master);
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.3;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dl = ctx.createGain(); dl.gain.value = 0.25;
    this.delay.connect(fb).connect(this.delay); this.delay.connect(dl).connect(this.musicBus);
    this.noiseBuf = this._makeNoise();
    // continuous voices: the reactor/charge hum and the thruster roar
    this._hum = this._makeHum();
    this._jet = this._makeJet();
    this._loadTracks();
    this._timer = setInterval(() => this._schedule(), 25);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    this._emit();
  }
  toggleMute() { this.setMuted(!this.muted); }
  setMusic(on) {
    this.musicOn = on;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.2);
    if (this._file) this._file.gain.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.2);
    this._emit();
  }
  toggleMusic() { this.setMusic(!this.musicOn); }

  /** The chapter changed: its theme (or its own file) takes over. */
  setScene(id, mood = 'calm') {
    this.scene = id;
    this.mood = mood;
    this.moodUntil = 0;
    this._playFile(id);
  }

  /** A mood (e.g. 'battle') for a few seconds, then back to the chapter's theme. */
  setMood(m, seconds = 12) {
    this.mood = m;
    this.moodUntil = this.ctx ? this.ctx.currentTime + seconds : 0;
  }

  _theme() {
    if (this.mood === 'battle') return THEMES.battle;
    return THEMES[THEME_OF[this.scene] || this.scene] || THEMES.prologue;
  }

  /* ---------------- optional licensed tracks ---------------- */

  async _loadTracks() {
    try {
      const r = await fetch('./music/tracks.json');
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) this._tracks = await r.json();
    } catch (_) { /* none */ }
    if (this._tracks) this._playFile(this.scene);
  }

  async _playFile(id) {
    if (!this.ctx) return;
    const file = this._tracks?.[id];
    if (this._file && this._file.id === id) return;
    if (this._file) { const f = this._file; f.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4); setTimeout(() => { try { f.src.stop(); } catch (_) { /* done */ } }, 2000); this._file = null; }
    if (!file) return;
    try {
      const buf = await fetch(`./music/${file}`).then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b));
      if (this.scene !== id) return;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      src.connect(gain).connect(this.master);
      src.start();
      gain.gain.setTargetAtTime(this.musicOn ? 0.7 : 0, this.ctx.currentTime, 0.6);
      this._file = { id, src, gain };
    } catch (_) { /* fall back to the score */ }
  }

  /* ---------------- building blocks ---------------- */

  _impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  _makeNoise() {
    const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _makeHum() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 6;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 110;
    o1.connect(f); o2.connect(f); f.connect(g).connect(this.sfxBus);
    o1.start(); o2.start();
    return { g, f, o1, o2 };
  }

  _makeJet() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 70;
    const og = ctx.createGain(); og.gain.value = 0;
    src.connect(f).connect(g).connect(this.sfxBus);
    o.connect(og).connect(this.sfxBus);
    src.start(); o.start();
    return { g, f, o, og };
  }

  _env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone({ freq = 440, to = null, type = 'sine', dur = 0.25, vol = 0.2, attack = 0.005, delay = 0, reverb = 0.2 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, attack, vol, dur);
    o.connect(g).connect(this.sfxBus);
    if (reverb) { const s = this.ctx.createGain(); s.gain.value = reverb; g.connect(s).connect(this.reverb); }
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  noise({ dur = 0.4, vol = 0.3, type = 'lowpass', freq = 1200, to = null, q = 1, attack = 0.01, delay = 0, reverb = 0.2 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, attack, vol, dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    if (reverb) { const s = this.ctx.createGain(); s.gain.value = reverb; g.connect(s).connect(this.reverb); }
    src.start(t, Math.random()); src.stop(t + attack + dur + 0.05);
  }

  /* ---------------- the sound kit ---------------- */

  click() { this.tone({ freq: 1400, to: 900, type: 'triangle', dur: 0.06, vol: 0.06, reverb: 0 }); }
  hover() { this.tone({ freq: 2200, type: 'sine', dur: 0.04, vol: 0.025, reverb: 0 }); }
  whoosh() { this.noise({ dur: 0.5, vol: 0.22, type: 'bandpass', freq: 300, to: 3000, q: 0.8, attack: 0.1 }); this.tone({ freq: 200, to: 800, type: 'sine', dur: 0.5, vol: 0.04 }); }
  swoosh() { this.noise({ dur: 0.25, vol: 0.18, type: 'bandpass', freq: 3000, to: 700, q: 1.2, attack: 0.02 }); }
  /** A HUD blip. */
  beep(i = 0) { this.tone({ freq: 1600 + i * 220, type: 'square', dur: 0.05, vol: 0.035, reverb: 0.05 }); }
  /** Target locked. */
  lock() { this.tone({ freq: 1800, type: 'square', dur: 0.05, vol: 0.04 }); this.tone({ freq: 2400, type: 'square', dur: 0.08, vol: 0.04, delay: 0.07 }); }
  scan() { this.tone({ freq: 400, to: 2400, type: 'sine', dur: 0.6, vol: 0.05, attack: 0.05 }); }
  hologram() { this.tone({ freq: 880, to: 1760, type: 'sine', dur: 0.3, vol: 0.04 }); this.noise({ dur: 0.3, vol: 0.05, type: 'highpass', freq: 5000 }); }
  chime() { [0, 0.08, 0.16].forEach((d, i) => this.tone({ freq: [880, 1175, 1760][i], type: 'sine', dur: 0.5, vol: 0.07, delay: d })); }
  wrong() { this.tone({ freq: 240, to: 120, type: 'square', dur: 0.3, vol: 0.05 }); }
  alarm() { for (let i = 0; i < 3; i++) { this.tone({ freq: 880, type: 'square', dur: 0.12, vol: 0.04, delay: i * 0.25 }); this.tone({ freq: 660, type: 'square', dur: 0.1, vol: 0.04, delay: i * 0.25 + 0.12 }); } }
  /** A metal part locking into place. */
  clank() { this.noise({ dur: 0.08, vol: 0.25, type: 'highpass', freq: 2500, reverb: 0.3 }); this.tone({ freq: 320, to: 180, type: 'square', dur: 0.1, vol: 0.08 }); this.tone({ freq: 2100, type: 'sine', dur: 0.3, vol: 0.03, delay: 0.01 }); }
  /** A servo whirr (a plate sliding, a joint moving). */
  servo(dur = 0.35) { this.tone({ freq: 300, to: 520, type: 'sawtooth', dur, vol: 0.03, reverb: 0.05 }); this.noise({ dur, vol: 0.05, type: 'bandpass', freq: 1800, q: 4 }); }
  /** Hammer on hot metal. */
  hammer() { this.noise({ dur: 0.06, vol: 0.45, type: 'highpass', freq: 1500, reverb: 0.5 }); this.tone({ freq: 1250, to: 1150, type: 'triangle', dur: 0.6, vol: 0.06, reverb: 0.5 }); this.tone({ freq: 3170, type: 'sine', dur: 0.4, vol: 0.025 }); }
  spark() { this.noise({ dur: 0.12, vol: 0.12, type: 'highpass', freq: 6000, reverb: 0.1 }); }
  thud() { this.tone({ freq: 140, to: 45, type: 'sine', dur: 0.3, vol: 0.35 }); this.noise({ dur: 0.08, vol: 0.2, freq: 2500 }); }
  /** A repulsor blast. */
  repulsor(power = 1) {
    this.tone({ freq: 900 * power, to: 120, type: 'sawtooth', dur: 0.35, vol: 0.09 });
    this.noise({ dur: 0.35, vol: 0.28, type: 'bandpass', freq: 2600, to: 300, q: 0.8, reverb: 0.35 });
    this.tone({ freq: 60, to: 40, type: 'sine', dur: 0.3, vol: 0.25 });
  }
  /** The chest beam. */
  unibeam() {
    this.tone({ freq: 180, to: 1400, type: 'sawtooth', dur: 0.5, vol: 0.06, attack: 0.3 });
    this.noise({ dur: 1.6, vol: 0.35, type: 'lowpass', freq: 4000, to: 400, attack: 0.05, delay: 0.3, reverb: 0.5 });
    this.tone({ freq: 55, to: 35, type: 'sine', dur: 1.6, vol: 0.35, delay: 0.3 });
  }
  missile() { this.noise({ dur: 0.9, vol: 0.2, type: 'bandpass', freq: 800, to: 3000, q: 1.5, attack: 0.03 }); this.tone({ freq: 500, to: 1500, type: 'sawtooth', dur: 0.5, vol: 0.03 }); }
  boom() { this.noise({ dur: 1.6, vol: 0.5, type: 'lowpass', freq: 1400, to: 70, attack: 0.01, reverb: 0.5 }); this.tone({ freq: 90, to: 28, type: 'sine', dur: 1.2, vol: 0.45 }); }
  zap() { this.tone({ freq: 3000, to: 200, type: 'sawtooth', dur: 0.15, vol: 0.05 }); this.noise({ dur: 0.1, vol: 0.12, type: 'highpass', freq: 4000 }); }
  /** Systems coming online. */
  powerUp() {
    this.tone({ freq: 80, to: 640, type: 'sawtooth', dur: 1.1, vol: 0.05, attack: 0.2 });
    this.tone({ freq: 160, to: 1280, type: 'sine', dur: 1.1, vol: 0.06, attack: 0.2 });
    this.chime();
  }
  powerDown() { this.tone({ freq: 900, to: 60, type: 'sawtooth', dur: 1.2, vol: 0.05 }); }
  /** The faceplate closing. */
  visor() { this.servo(0.25); setTimeout(() => this.clank(), 230); setTimeout(() => this.tone({ freq: 700, to: 1400, type: 'sine', dur: 0.25, vol: 0.05 }), 380); }

  /** Continuous reactor / charge hum: p 0..1 (0 = silent). */
  charge(p) {
    if (!this.ctx) return;
    const h = this._hum, t = this.ctx.currentTime;
    h.g.gain.setTargetAtTime(this.muted ? 0 : p * 0.09, t, 0.05);
    h.o1.frequency.setTargetAtTime(55 + p * 165, t, 0.05);
    h.o2.frequency.setTargetAtTime(110 + p * 440, t, 0.05);
    h.f.frequency.setTargetAtTime(300 + p * 2600, t, 0.05);
  }

  /** Continuous thruster roar: p 0..1 (0 = off). */
  thrust(p) {
    if (!this.ctx) return;
    const j = this._jet, t = this.ctx.currentTime;
    j.g.gain.setTargetAtTime(this.muted ? 0 : p * 0.22, t, 0.08);
    j.f.frequency.setTargetAtTime(400 + p * 1600, t, 0.08);
    j.og.gain.setTargetAtTime(this.muted ? 0 : p * 0.03, t, 0.08);
    j.o.frequency.setTargetAtTime(60 + p * 60, t, 0.08);
  }

  /* ---------------- the score ---------------- */

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || this._file) return;
    if (this.moodUntil && ctx.currentTime > this.moodUntil) { this.mood = 'calm'; this.moodUntil = 0; }
    const th = this._theme();
    const spb = 60 / th.bpm / 4; // seconds per 16th
    if (this._nextTime < ctx.currentTime) this._nextTime = ctx.currentTime + 0.05;
    while (this._nextTime < ctx.currentTime + 0.12) {
      if (this.musicOn && !this.muted) this._playStep(th, this._step % 128, this._nextTime, spb);
      this._nextTime += spb;
      this._step++;
    }
  }

  _playStep(th, s, t, spb) {
    const bar = Math.floor(s / 16), st = s % 16;
    const root = th.prog[bar % th.prog.length];
    if (th.kick[st]) this._kick(t, th.kick[st]);
    if (th.snare[st]) this._snare(t, th.snare[st]);
    if (th.hat[st]) this._hat(t, th.hat[st]);
    if (th.bass.includes(st)) this._bass(note(th, root, -1), t, spb * 1.8, th.cut);
    const a = th.arp[st];
    if (a != null) this._pluck(note(th, root + CHORD[a % CHORD.length], 1), t, spb * 1.5, th.arpVel, th.cut);
    if (st === 0) this._pad([0, 2, 4].map((k) => note(th, root + k, 0)), t, spb * 16, th.pad, th.cut);
    // the lead: find the note that starts at this step
    let pos = 0;
    for (const [deg, len] of th.lead) {
      if (pos === s && deg != null) this._lead(note(th, deg, 1), t, len * spb, th.leadVel);
      pos += len;
      if (pos > s) break;
    }
  }

  _voice(t, dur, vol, { reverb = 0.25, delay = 0 } = {}) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.musicBus);
    if (reverb) { const r = this.ctx.createGain(); r.gain.value = reverb; g.connect(r).connect(this.reverb); }
    if (delay) { const d = this.ctx.createGain(); d.gain.value = delay; g.connect(d).connect(this.delay); }
    return g;
  }

  _kick(t, v) {
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = this._voice(t, 0.3, 0.32 * v, { reverb: 0 });
    o.connect(g); o.start(t); o.stop(t + 0.32);
  }

  _snare(t, v) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = this._voice(t, 0.2, 0.12 * v, { reverb: 0.3 });
    src.connect(f).connect(g); src.start(t, Math.random()); src.stop(t + 0.22);
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.1);
    const og = this._voice(t, 0.12, 0.05 * v, { reverb: 0 });
    o.connect(og); o.start(t); o.stop(t + 0.14);
  }

  _hat(t, v) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
    const g = this._voice(t, 0.05, 0.035 * v, { reverb: 0 });
    src.connect(f).connect(g); src.start(t, Math.random()); src.stop(t + 0.06);
  }

  _bass(freq, t, dur, cut) {
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = freq / 2;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(200 + cut * 900, t); f.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = this._voice(t, dur, 0.09, { reverb: 0 });
    o.connect(f); o2.connect(f); f.connect(g);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  _pluck(freq, t, dur, vol, cut) {
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(800 + cut * 4000, t); f.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = this._voice(t, dur, vol, { reverb: 0.2, delay: 0.5 });
    o.connect(f).connect(g); o.start(t); o.stop(t + dur + 0.02);
  }

  _pad(freqs, t, dur, vol, cut) {
    if (!vol) return;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + cut * 1500; f.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
    f.connect(g).connect(this.musicBus);
    const r = this.ctx.createGain(); r.gain.value = 0.5; g.connect(r).connect(this.reverb);
    for (const fr of freqs) for (const det of [-8, 8]) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur * 1.1);
    }
  }

  _lead(freq, t, dur, vol) {
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const o2 = this.ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 2;
    // a little vibrato once the note is held
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 5.5;
    const lg = this.ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * 0.006, t + Math.min(dur, 0.6));
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200; f.Q.value = 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
    g.gain.setValueAtTime(vol, t + Math.max(0.05, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    o.connect(f); o2.connect(f); f.connect(g).connect(this.musicBus);
    const r = this.ctx.createGain(); r.gain.value = 0.4; g.connect(r).connect(this.reverb);
    const d = this.ctx.createGain(); d.gain.value = 0.35; g.connect(d).connect(this.delay);
    for (const n of [o, o2, lfo]) { n.start(t); n.stop(t + dur + 0.15); }
  }
}

export const sfx = new Sfx();
