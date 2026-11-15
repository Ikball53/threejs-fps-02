// Boot: start IRONVEIL in the browser.
//
// URL parameters:
//   ?shot=cover|fight|site|buy&seed=N  — stage one of the four screenshots
//   ?demo=1                            — attract mode: bots fight, the camera
//                                        slowly orbits the yard
//   ?seed=N                            — the simulation seed (default is the
//                                        yard's own fixed seed, so a plain
//                                        load is deterministic too)
//
// In interactive mode the game starts in the buy phase; click the window to
// capture the mouse and play. The loading screen is removed once the first
// frame renders. window.__ironveil exposes the live game for the screenshot
// driver and for debugging: { game, ready }.

import { createGame } from './engine.js';
import { hashSeed } from './rng.js';

const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const seed = seedParam !== null ? hashSeed(seedParam) : hashSeed('ironveil-dockside');
const shot = params.get('shot');
const demo = params.get('demo') === '1';

const root = document.getElementById('game-root');
const game = createGame(root, { seed, shot, demo });

window.__ironveil = { game, ready: false };

// The loading screen goes away after the first rendered frame.
let frames = 0;
const originalRender = game.renderer.render.bind(game.renderer);
game.renderer.render = (...args) => {
  originalRender(...args);
  frames++;
  if (frames === 2) {
    const loading = document.getElementById('hud-loading');
    if (loading) loading.remove();
    window.__ironveil.ready = true;
  }
};

window.addEventListener('resize', () => {
  const w = root.clientWidth || 1280;
  const h = root.clientHeight || 720;
  game.camera.aspect = w / h;
  game.camera.updateProjectionMatrix();
  game.renderer.setSize(w, h);
});
