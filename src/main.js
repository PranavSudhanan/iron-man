import { App } from './core/App.js';
import { Prologue } from './chapters/Prologue.js';
import { Cave } from './chapters/Cave.js';
import { Workshop } from './chapters/Workshop.js';
import { SuitUp } from './chapters/SuitUp.js';
import { Flight } from './chapters/Flight.js';
import { Hud } from './chapters/Hud.js';
import { Repulsors } from './chapters/Repulsors.js';
import { Armory } from './chapters/Armory.js';
import { Reactor } from './chapters/Reactor.js';
import { Battle } from './chapters/Battle.js';
import { Protege } from './chapters/Protege.js';
import { Timeline } from './chapters/Timeline.js';
import { Trials } from './chapters/Trials.js';
import { setSuitEnvironment } from './objects/Suit.js';
import { initEnv, loadEnv, envMap, HDRIS } from './core/Env.js';
import { MODELS, prefetchModels } from './objects/RealSuit.js';
import { whenIdle } from './core/Assets.js';

const loader = document.getElementById('loader');
const bar = document.getElementById('loader-progress');
const enterBtn = document.getElementById('enter-btn');
const progress = (p) => { bar.style.width = `${Math.round(p * 100)}%`; };
const frame = () => new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 60); });

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch (_) {
    return false;
  }
}

async function boot() {
  if (!webglAvailable()) {
    enterBtn.textContent = 'WebGL 2 is not available on this device';
    return;
  }
  progress(0.1);
  // canvas textures and HUD text need the web fonts
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('900 64px Orbitron'),
        document.fonts.load('700 64px Orbitron'),
        document.fonts.load('700 32px Rajdhani'),
        document.fonts.load('600 32px Rajdhani'),
        document.fonts.load('500 32px Inter'),
      ]),
      new Promise((r) => setTimeout(r, 3500)),
    ]);
  } catch (_) { /* fall back to system fonts */ }
  progress(0.4);

  const app = new App();
  initEnv(app.renderer);
  await Promise.race([loadEnv(HDRIS.studio), new Promise((r) => setTimeout(r, 6000))]);
  setSuitEnvironment(app.renderer, envMap(HDRIS.studio));
  window.__ironman = app;
  [Prologue, Cave, Workshop, SuitUp, Flight, Hud, Repulsors, Armory, Reactor, Battle, Protege, Timeline, Trials].forEach((C) => app.add(new C(app)));
  app.buildNav();

  const fromHash = app.chapters.findIndex((c) => c.id === location.hash.slice(1));
  const first = fromHash >= 0 ? fromHash : 0;
  const ch = app.chapters[first];
  await app.prepare(ch);
  progress(0.55);
  await frame();
  app.ensureBuilt(ch);
  progress(0.7);
  // the Enter button waits for the first scene's shaders, so its first frames are smooth
  await Promise.race([Promise.all([ch._compiled, app.passesCompiled]), new Promise((r) => setTimeout(r, 8000))]);
  progress(0.9);
  app.start(first);
  await frame();
  await frame();
  progress(1);
  document.querySelector('.loader-reactor')?.classList.add('ready');
  loader.classList.add('live'); // the hangar and the dormant suit show through behind the title
  document.body.classList.add('title-card');

  // While the loader waits for the click, the next chapter is built, compiled and uploaded, so the first
  // move on is quick. Once the viewer is in, this stops: building then would freeze the scene they see.
  const next = app.chapters[(first + 1) % app.chapters.length];
  const waiting = () => !loader.classList.contains('done');
  setTimeout(async () => {
    if (!waiting()) return;
    await app.prepare(next);
    if (!waiting() || next.built) return;
    app.ensureBuilt(next);
    await next._compiled;
    if (waiting()) app.warm(next);
  }, 250);

  enterBtn.disabled = false;
  enterBtn.textContent = 'Power up';
  enterBtn.focus();
  enterBtn.addEventListener('click', () => {
    if (app.isTouch) app.tilt.request(); // iOS only asks from inside a tap
    app.sfx.unlock();
    app.sfx.setScene(app.current.id, app.current.mood);
    app.sfx.powerUp();
    loader.classList.add('done');
    document.body.classList.remove('title-card');
    app.current.onEnter?.();
    // the model files download in the background, a few at a time, so later chapters open without waiting
    const queue = ['tpose', 'mk1', 'classic', 'mk5raw', 'mk85', 'nano', 'helmetB', 'reactor', 'spider', 'mk42', 'helmetA', 'heavy'];
    const next = () => { if (queue.length) { prefetchModels([queue.shift()]); setTimeout(() => whenIdle(next), 1500); } };
    setTimeout(() => whenIdle(next), 2500);
  }, { once: true });
}

/** The credits panel: every model's artist and licence (their licences require it). */
function setupCredits() {
  const panel = document.getElementById('credits');
  const list = document.getElementById('credits-models');
  for (const m of Object.values(MODELS)) {
    const li = document.createElement('li');
    const title = document.createElement('b'); title.textContent = m.title;
    li.append(title, document.createTextNode(` — ${m.author} · ${m.license}`));
    if (m.source) { const a = document.createElement('a'); a.href = m.source; a.target = '_blank'; a.rel = 'noopener'; a.textContent = ' (source)'; li.append(a); }
    list.append(li);
  }
  // the photographed skies, light and surfaces (CC0 / public domain; credited all the same)
  const li = document.createElement('li');
  const title = document.createElement('b'); title.textContent = 'HDRI skies & PBR textures';
  const a = document.createElement('a'); a.href = 'https://polyhaven.com'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = ' (polyhaven.com)';
  li.append(title, document.createTextNode(' — Poly Haven (Greg Zaal, Sergej Majboroda, Rob Tuytel and team) · CC0'), a);
  list.append(li);
  const open = (on) => { panel.classList.toggle('hidden', !on); if (on) document.getElementById('credits-close').focus(); };
  document.getElementById('credits-btn').addEventListener('click', () => open(true));
  document.getElementById('credits-close').addEventListener('click', () => open(false));
  panel.addEventListener('click', (e) => { if (e.target === panel) open(false); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
}
setupCredits();

boot();
