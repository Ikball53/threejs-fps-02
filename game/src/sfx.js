// sfx.js — sound, synthesized with WebAudio: no audio files are shipped,
// every shot, hit, reload, beep and round sting is made from oscillators
// and filtered noise at runtime.

export function createSfx() {
  const sfx = { ctx: null, master: null, enabled: true };
  return sfx;
}

function ensure(sfx) {
  if (!sfx.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    sfx.ctx = new AC();
    sfx.master = sfx.ctx.createGain();
    sfx.master.gain.value = 0.5;
    sfx.master.connect(sfx.ctx.destination);
  }
  if (sfx.ctx.state === "suspended") void sfx.ctx.resume();
  return sfx.ctx;
}

function noiseBurst(sfx, dur, freq, gain, type = "lowpass") {
  const ctx = ensure(sfx);
  if (!ctx) return;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter);
  filter.connect(g);
  g.connect(sfx.master);
  src.start();
}

function tone(sfx, freq, dur, gain, type = "sine", slideTo = null) {
  const ctx = ensure(sfx);
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  osc.connect(g);
  g.connect(sfx.master);
  osc.start();
  osc.stop(ctx.currentTime + dur);
}

export function playShot(sfx, kind) {
  if (kind === "marksman") { noiseBurst(sfx, 0.22, 900, 0.9); tone(sfx, 140, 0.18, 0.5, "square", 50); }
  else if (kind === "scatter") { noiseBurst(sfx, 0.18, 1400, 0.8); tone(sfx, 110, 0.14, 0.4, "square", 55); }
  else if (kind === "smg") { noiseBurst(sfx, 0.09, 2200, 0.5); tone(sfx, 220, 0.07, 0.25, "square", 90); }
  else if (kind === "carbine") { noiseBurst(sfx, 0.12, 1800, 0.65); tone(sfx, 180, 0.1, 0.35, "square", 70); }
  else { noiseBurst(sfx, 0.1, 2600, 0.45); tone(sfx, 260, 0.08, 0.2, "square", 110); }
}

export function playHit(sfx, headshot) {
  tone(sfx, headshot ? 1900 : 1400, 0.06, 0.3, "sine");
}

export function playReload(sfx) {
  tone(sfx, 500, 0.05, 0.2, "square");
  setTimeout(() => tone(sfx, 700, 0.05, 0.2, "square"), 260);
  setTimeout(() => tone(sfx, 900, 0.05, 0.25, "square"), 520);
}

export function playDry(sfx) {
  tone(sfx, 300, 0.04, 0.2, "square");
}

export function playBeep(sfx, high) {
  tone(sfx, high ? 1200 : 800, 0.12, 0.3, "sine");
}

export function playPlant(sfx) {
  tone(sfx, 1000, 0.1, 0.3, "sine");
  setTimeout(() => tone(sfx, 1000, 0.1, 0.3, "sine"), 180);
}

export function playBlast(sfx) {
  noiseBurst(sfx, 0.9, 300, 1.0);
  tone(sfx, 90, 0.8, 0.7, "sine", 30);
}

export function playRound(sfx, won) {
  const notes = won ? [523, 659, 784] : [392, 330, 262];
  notes.forEach((n, i) => setTimeout(() => tone(sfx, n, 0.22, 0.3, "triangle"), i * 160));
}

export function playStep(sfx) {
  noiseBurst(sfx, 0.05, 500, 0.08);
}
