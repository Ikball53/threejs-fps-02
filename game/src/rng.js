// Seeded randomness for IRONVEIL.
//
// Every random choice in the game — bot behaviour jitter, spread rolls,
// cosmetic variation — comes from one of these streams, each seeded from a
// single 32-bit seed. The same seed always produces the same sequence, so a
// staged screenshot or a demo replay is identical every time it runs, and
// the simulation is deterministic: two runs with the same seed agree on
// every shot, every bot decision and every round result.
//
// The generator is mulberry32: small, fast, and good enough for gameplay
// randomness. Nothing here reads Math.random or Date.now.

/** Turn any string into a stable 32-bit seed. */
export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A mulberry32 stream. Call next() for a float in [0, 1). */
export function makeStream(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Float in [lo, hi). */
    range(lo, hi) {
      return lo + (hi - lo) * this.next();
    },
    /** Integer in [lo, hi]. */
    int(lo, hi) {
      return lo + Math.floor(this.next() * (hi - lo + 1));
    },
    /** Pick one element of a non-empty array. */
    pick(list) {
      return list[Math.floor(this.next() * list.length)];
    },
    /** True with probability p. */
    chance(p) {
      return this.next() < p;
    },
    /** In-place Fisher-Yates shuffle, deterministic for this stream. */
    shuffle(list) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
      }
      return list;
    },
  };
}

/** A gaussian-ish value centred on 0, from three averaged draws. */
export function bell(stream) {
  return (stream.next() + stream.next() + stream.next() - 1.5) / 1.5;
}

/** Clamp a value into [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
