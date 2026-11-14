// audio.js — procedural WebAudio sounds. No audio assets; every effect is
// synthesized (noise burst / oscillator sweep) so the game ships no files.

let ctx = null;
let master = null;

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}

function noiseBuf(dur) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  return buf;
}

function burst(dur, freq, type, vol, slideTo) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf(dur);
  const f = ctx.createBiquadFilter();
  f.type = type || 'lowpass'; f.frequency.setValueAtTime(freq, t);
  if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

function tone(freq, dur, type, vol, slideTo, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  shot(weaponId) {
    if (weaponId === 'rifle') { burst(0.11, 1800, 'lowpass', 0.9, 300); tone(160, 0.08, 'square', 0.25, 60); }
    else { burst(0.09, 2400, 'bandpass', 0.7, 500); tone(220, 0.06, 'square', 0.2, 90); }
  },
  enemyShot(dist) {
    const v = Math.max(0.15, 0.8 - dist * 0.02);
    burst(0.1, 1400, 'lowpass', v, 250);
  },
  dryFire() { tone(1200, 0.04, 'square', 0.15); },
  reload() { tone(500, 0.05, 'square', 0.2); tone(700, 0.05, 'square', 0.2, null, 0.35); tone(900, 0.06, 'square', 0.25, null, 0.8); },
  hit() { tone(1800, 0.05, 'sine', 0.3, 1200); },
  kill() { tone(660, 0.09, 'sine', 0.35); tone(990, 0.12, 'sine', 0.35, null, 0.09); },
  hurt() { burst(0.15, 500, 'lowpass', 0.6, 150); tone(110, 0.15, 'sawtooth', 0.25, 70); },
  grenade() { burst(0.5, 900, 'lowpass', 1.0, 80); tone(60, 0.4, 'sine', 0.7, 30); },
  plantBeep() { tone(1200, 0.08, 'sine', 0.3); },
  plantDone() { tone(880, 0.15, 'sine', 0.35); tone(1320, 0.25, 'sine', 0.35, null, 0.15); },
  roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.22, 'triangle', 0.35, null, i * 0.12)); },
  roundLose() { [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'triangle', 0.3, null, i * 0.13)); },
  buy() { tone(980, 0.07, 'sine', 0.3); tone(1240, 0.09, 'sine', 0.3, null, 0.07); },
  click() { tone(800, 0.03, 'square', 0.12); },
};
