// Effects: everything you see when a shot is fired or a grenade goes off.
//
// Tracers are short-lived glowing lines from muzzle to impact. Muzzle
// flashes are a sprite and a point light that die within a few frames.
// Smoke is a cluster of soft billboards that grows, drifts and thins over
// fourteen seconds — and, crucially, it is also a game object: the bots'
// vision test asks these same clouds whether a sight line is blocked, so
// smoke that looks like cover is cover. Explosions throw sparks and a
// shockwave ring. All effects are pooled and fade; nothing here allocates
// per frame in the hot loop beyond a handful of reused vectors.

import * as THREE from 'three';
import { clamp, makeStream } from './rng.js';

// A soft round puff, painted once on a canvas: smoke is a billboard, and a
// plain white square reads as a wall. A radial gradient makes each puff
// fade to nothing at its edge, so a cloud looks like smoke, not panels.
let puffTexture = null;
function getPuffTexture() {
  if (puffTexture) return puffTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const c = canvas.getContext('2d');
  const grad = c.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.38)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = grad;
  c.fillRect(0, 0, 128, 128);
  puffTexture = new THREE.CanvasTexture(canvas);
  return puffTexture;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.flashes = [];
    this.sparkLines = [];
    this.smokes = []; // gameplay smoke: { x, y, z, r, born, life }
    this.rings = [];
    // Jitter for sparks comes from a seeded stream, not Math.random, so
    // the same simulation always draws the same sparks.
    this.jitter = makeStream(0x9e3779b9);
    this.flashLight = new THREE.PointLight(0xffc36a, 0, 14, 1.8);
    this.scene.add(this.flashLight);
    this._flashUntil = 0;
  }

  /** A tracer from the muzzle to the impact point, in the weapon's colour. */
  tracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });
  }

  /** Muzzle flash: a bright sprite at the muzzle plus a short light pulse. */
  muzzle(at, dir) {
    const mat = new THREE.SpriteMaterial({
      color: 0xffc36a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at);
    sprite.scale.set(0.55, 0.55, 1);
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: 0.06 });
    this.flashLight.position.copy(at).add(dir.clone().multiplyScalar(0.4));
    this.flashLight.intensity = 26;
    this._flashUntil = 0.07;
  }

  /** Impact sparks where a bullet hits a wall or a crate. */
  sparks(at, count, color = 0xffb347) {
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        at,
        at.clone().add(new THREE.Vector3(
          (this.jitter.next() - 0.5) * 0.5,
          this.jitter.next() * 0.4,
          (this.jitter.next() - 0.5) * 0.5,
        )),
      ]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0.9,
      }));
      this.scene.add(line);
      this.sparkLines.push({ line, life: 0.22 });
    }
  }

  /** A puff of blood-red mist where a fighter is hit. */
  hitPuff(at) {
    const mat = new THREE.SpriteMaterial({
      color: 0xb02020, map: getPuffTexture(), transparent: true, opacity: 0.7, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at);
    sprite.scale.set(0.4, 0.4, 1);
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: 0.25 });
  }

  /**
   * A smoke cloud: a cluster of soft grey billboards around a centre, plus
   * the gameplay volume the vision test reads. Lasts fourteen seconds.
   */
  smoke(x, y, z, now) {
    const cloud = { x, y: y + 0.9, z, r: 3.4, born: now, life: 14, sprites: [] };
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.SpriteMaterial({
        color: 0xbfc4c9, map: getPuffTexture(), transparent: true, opacity: 0.55, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      const a = (i / 9) * Math.PI * 2;
      const rr = 0.6 + (i % 3) * 0.9;
      sprite.position.set(x + Math.cos(a) * rr, y + 0.7 + (i % 3) * 0.7, z + Math.sin(a) * rr);
      const s = 2.2 + (i % 4) * 0.7;
      sprite.scale.set(s, s, 1);
      this.scene.add(sprite);
      cloud.sprites.push(sprite);
    }
    this.smokes.push(cloud);
    return cloud;
  }

  /** An explosion: a flash, a ring, sparks, and a gameplay radius. */
  explosion(at, now) {
    const mat = new THREE.SpriteMaterial({
      color: 0xffa040, transparent: true, opacity: 1, blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at);
    sprite.scale.set(3.5, 3.5, 1);
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: 0.3 });
    const ringGeo = new THREE.RingGeometry(0.4, 0.55, 40);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffc36a, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    }));
    ring.position.copy(at);
    ring.position.y += 0.15;
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    this.rings.push({ ring, life: 0.5 });
    this.sparks(at, 10, 0xff7a3c);
    this.flashLight.position.copy(at);
    this.flashLight.intensity = 60;
    this._flashUntil = 0.18;
  }

  /** Advance every effect by dt; remove what has faded. Expired smoke leaves. */
  update(dt, now) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      f.sprite.material.opacity = Math.max(0, f.life * 3);
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(i, 1);
      }
    }
    for (let i = this.sparkLines.length - 1; i >= 0; i--) {
      const s = this.sparkLines[i];
      s.life -= dt;
      s.line.material.opacity = Math.max(0, s.life / 0.22) * 0.9;
      if (s.life <= 0) {
        this.scene.remove(s.line);
        s.line.geometry.dispose();
        s.line.material.dispose();
        this.sparkLines.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const t = 1 - Math.max(0, r.life / 0.5);
      r.ring.scale.setScalar(1 + t * 9);
      r.ring.material.opacity = Math.max(0, 0.9 * (1 - t));
      if (r.life <= 0) {
        this.scene.remove(r.ring);
        r.ring.geometry.dispose();
        r.ring.material.dispose();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const c = this.smokes[i];
      const age = now - c.born;
      const t = clamp(age / c.life, 0, 1);
      const opacity = t < 0.12 ? (t / 0.12) * 0.55 : 0.55 * (1 - Math.max(0, (t - 0.7) / 0.3));
      for (const s of c.sprites) s.material.opacity = opacity;
      if (age >= c.life) {
        for (const s of c.sprites) {
          this.scene.remove(s);
          s.material.dispose();
        }
        this.smokes.splice(i, 1);
      }
    }
    if (this._flashUntil > 0) {
      this._flashUntil -= dt;
      this.flashLight.intensity *= 0.82;
      if (this._flashUntil <= 0) this.flashLight.intensity = 0;
    }
  }

  /** The gameplay volumes, for the bots' vision test. */
  smokeVolumes() {
    return this.smokes.map((c) => ({ x: c.x, y: c.y, z: c.z, r: c.r }));
  }
}
