// The HUD: everything the player reads while playing.
//
// A canvas minimap drawn from the arena data itself (walls, sites, the
// planted device, teammates as dots, spotted enemies as red dots), team
// rosters with health, a kill feed, a hurt-direction indicator that points
// at whoever just shot you, health and armour bars, ammunition, the round
// score and timer, a crosshair whose gap grows with spread, the buy menu,
// and the full match-end scoreboard. All of it is plain DOM and one 2D
// canvas, rebuilt from the game state every frame — no separate state.

import { ARENA, SOLIDS, SITES } from './arena.js';
import { TEAMS } from './fighters.js';

const TEAM_CSS = { attack: '#e07a2e', defend: '#2fa8bf' };

export class Hud {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = `
      <div id="hud-top">
        <div id="hud-score"><span class="team-a"></span><span id="hud-score-nums">0 : 0</span><span class="team-b"></span></div>
        <div id="hud-timer">0:00</div>
        <div id="hud-phase"></div>
      </div>
      <div id="hud-banner"></div>
      <div id="hud-killfeed"></div>
      <div id="hud-minimap-wrap"><canvas id="hud-minimap" width="220" height="150"></canvas><div id="hud-minimap-label">DOCKSIDE FOUNDRY</div></div>
      <div id="hud-rosters"><div id="roster-a"></div><div id="roster-b"></div></div>
      <div id="hud-crosshair"><div class="ch-dot"></div><div class="ch-line ch-t"></div><div class="ch-line ch-b"></div><div class="ch-line ch-l"></div><div class="ch-line ch-r"></div></div>
      <div id="hud-hurt"></div>
      <div id="hud-hitmarker"></div>
      <div id="hud-bottom">
        <div id="hud-health"><div id="hud-hp-num">100</div><div id="hud-hp-bar"><div id="hud-hp-fill"></div></div><div id="hud-armor">KEVLAR 0</div></div>
        <div id="hud-ammo"><div id="hud-ammo-mag">30</div><div id="hud-ammo-res">/ 90</div><div id="hud-weapon">VK-47 Longshot</div></div>
      </div>
      <div id="hud-grenades"></div>
      <div id="hud-buymenu"></div>
      <div id="hud-scoreboard"></div>
      <div id="hud-hint">WASD move &nbsp;·&nbsp; Mouse aim &nbsp;·&nbsp; Click fire &nbsp;·&nbsp; R reload &nbsp;·&nbsp; B buy &nbsp;·&nbsp; Q grenade &nbsp;·&nbsp; TAB score</div>
      <div id="hud-flash"></div>
    `;
    this.minimap = this.root.querySelector('#hud-minimap');
    this.mm = this.minimap.getContext('2d');
    this.killfeed = this.root.querySelector('#hud-killfeed');
    this.banner = this.root.querySelector('#hud-banner');
    this.bannerUntil = 0;
    this.hurtAt = 0;
    this.hurtAngle = 0;
    this.hitAt = 0;
    this.hitKill = false;
    this.flashUntil = 0;
  }

  /** The big centre banner, shown for a few seconds. */
  showBanner(text, sub, seconds = 3) {
    this.banner.innerHTML = `<div class="banner-main">${text}</div><div class="banner-sub">${sub || ''}</div>`;
    this.banner.style.opacity = '1';
    this.bannerUntil = performance.now() / 1000 + seconds;
  }

  /** One line in the kill feed: killer, weapon, victim. */
  addKill(killer, victim, weaponName, headshot) {
    const line = document.createElement('div');
    line.className = 'kf-line';
    line.innerHTML = `<span style="color:${TEAM_CSS[killer.team]}">${killer.name}</span> <span class="kf-weapon">[${weaponName}${headshot ? ' ⌖' : ''}]</span> <span style="color:${TEAM_CSS[victim.team]}">${victim.name}</span>`;
    this.killfeed.prepend(line);
    while (this.killfeed.children.length > 5) this.killfeed.lastChild.remove();
    setTimeout(() => line.remove(), 6000);
  }

  addNote(text) {
    const line = document.createElement('div');
    line.className = 'kf-line kf-note';
    line.textContent = text;
    this.killfeed.prepend(line);
    while (this.killfeed.children.length > 5) this.killfeed.lastChild.remove();
    setTimeout(() => line.remove(), 6000);
  }

  /** A red arc pointing at the direction the damage came from. */
  hurt(fromAngle) {
    this.hurtAt = performance.now() / 1000;
    this.hurtAngle = fromAngle;
    const el = this.root.querySelector('#hud-hurt');
    el.style.transform = `translate(-50%,-50%) rotate(${fromAngle}rad)`;
    el.style.opacity = '1';
  }

  hitmarker(kill) {
    this.hitAt = performance.now() / 1000;
    this.hitKill = kill;
    const el = this.root.querySelector('#hud-hitmarker');
    el.className = kill ? 'hit-kill' : '';
    el.style.opacity = '1';
  }

  flashScreen(seconds) {
    this.flashUntil = performance.now() / 1000 + seconds;
  }

  /** Draw the minimap from the arena and the live game state. */
  drawMinimap(state) {
    const ctx = this.mm;
    const W = 220;
    const H = 150;
    const { minX, maxX, minZ, maxZ } = ARENA.bounds;
    const sx = (x) => ((x - minX) / (maxX - minX)) * W;
    const sz = (z) => ((z - minZ) / (maxZ - minZ)) * H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(12, 16, 20, 0.82)';
    ctx.fillRect(0, 0, W, H);
    // Walls and cover.
    ctx.fillStyle = '#5a636b';
    for (const s of SOLIDS) {
      if (s.y0 > 0.5) continue;
      ctx.fillRect(sx(s.x - s.w / 2), sz(s.z - s.d / 2), (s.w / (maxX - minX)) * W, (s.d / (maxZ - minZ)) * H);
    }
    // Plant sites.
    for (const site of [SITES.A, SITES.B]) {
      ctx.beginPath();
      ctx.arc(sx(site.x), sz(site.z), (site.r / (maxX - minX)) * W, 0, Math.PI * 2);
      ctx.fillStyle = state.plant.targetSite && state.plant.targetSite.id === site.id
        ? 'rgba(224, 122, 46, 0.35)' : 'rgba(120, 130, 140, 0.18)';
      ctx.fill();
      ctx.strokeStyle = '#e07a2e';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ffb347';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(site.id, sx(site.x), sz(site.z) + 4);
    }
    // The planted device blinks.
    if (state.plant.state === 'planted') {
      const blink = Math.sin(performance.now() / 120) > 0;
      ctx.beginPath();
      ctx.arc(sx(state.plant.x), sz(state.plant.z), 5, 0, Math.PI * 2);
      ctx.fillStyle = blink ? '#ff4040' : '#ffb347';
      ctx.fill();
    }
    // Fighters: teammates as dots, spotted enemies as red dots.
    for (const f of state.fighters) {
      if (!f.alive) continue;
      const isMe = f.isPlayer;
      ctx.beginPath();
      ctx.arc(sx(f.pos.x), sz(f.pos.z), isMe ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isMe ? '#ffffff' : TEAM_CSS[f.team];
      ctx.fill();
      if (isMe) {
        // Facing wedge.
        ctx.beginPath();
        ctx.moveTo(sx(f.pos.x), sz(f.pos.z));
        const fx = sx(f.pos.x) + Math.sin(f.yaw) * -9;
        const fz = sz(f.pos.z) + Math.cos(f.yaw) * -9;
        ctx.lineTo(fx, fz);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // Smoke clouds, faintly.
    for (const s of state.smokes) {
      ctx.beginPath();
      ctx.arc(sx(s.x), sz(s.z), (s.r / (maxX - minX)) * W, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200, 205, 210, 0.25)';
      ctx.fill();
    }
  }

  /** Refresh every HUD element from the game state. Call once per frame. */
  update(state, now) {
    const player = state.player;
    const match = state.match;
    const q = (id) => this.root.querySelector(id);

    q('#hud-score-nums').textContent = `${match.score.attack} : ${match.score.defend}`;
    q('#hud-score .team-a').textContent = TEAMS.attack.name;
    q('#hud-score .team-b').textContent = TEAMS.defend.name;
    const clock = Math.max(0, Math.ceil(match.clock));
    q('#hud-timer').textContent = `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`;
    q('#hud-phase').textContent =
      match.phase === 'buy' ? 'BUY PHASE' :
      match.phase === 'freeze' ? 'ROUND STARTS' :
      match.phase === 'live' ? (match.plant.state === 'planted' ? 'DEVICE PLANTED' : `ROUND ${match.round} — ${match.plant.targetSite ? match.plant.targetSite.name : ''}`) :
      match.phase === 'roundEnd' ? (match.roundReason || '') :
      'MATCH OVER';

    // Health, armour, ammo.
    q('#hud-hp-num').textContent = Math.ceil(player.hp);
    q('#hud-hp-fill').style.width = `${Math.max(0, player.hp)}%`;
    q('#hud-hp-fill').style.background = player.hp > 50 ? '#58d68d' : player.hp > 25 ? '#f5b041' : '#e74c3c';
    q('#hud-armor').textContent = player.armor > 0 ? `KEVLAR ${Math.ceil(player.armor)}${player.helmet ? ' + HELMET' : ''}` : 'NO ARMOUR';
    q('#hud-ammo-mag').textContent = player.ammo;
    q('#hud-ammo-res').textContent = `/ ${player.reserve}`;
    q('#hud-weapon').textContent = state.weaponName;
    const g = player.grenades || { flash: 0, smoke: 0, he: 0 };
    q('#hud-grenades').innerHTML =
      `<span class="${g.flash ? '' : 'dim'}">FLASH ${g.flash}</span> <span class="${g.smoke ? '' : 'dim'}">SMOKE ${g.smoke}</span> <span class="${g.he ? '' : 'dim'}">HE ${g.he}</span>` +
      (player.hasDevice ? ' <span class="device">◉ DEVICE</span>' : '');

    // Crosshair gap follows the current spread.
    const gap = 5 + state.spread * 900;
    const ch = this.root.querySelector('#hud-crosshair');
    ch.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    ch.style.opacity = state.aiming ? '0.85' : '1';

    // Hurt arc fades, hitmarker fades, banner fades, flash fades.
    const t = now;
    if (t - this.hurtAt > 0.7) q('#hud-hurt').style.opacity = '0';
    if (t - this.hitAt > 0.35) q('#hud-hitmarker').style.opacity = '0';
    if (this.bannerUntil && t > this.bannerUntil) {
      this.banner.style.opacity = '0';
      this.bannerUntil = 0;
    }
    q('#hud-flash').style.opacity = t < this.flashUntil ? '0.92' : '0';

    // Rosters.
    const roster = (team) => state.fighters
      .filter((f) => f.team === team)
      .map((f) => `<div class="roster-line ${f.alive ? '' : 'dead'}"><span class="roster-name">${f.name}${f.hasDevice ? ' ◉' : ''}</span><span class="roster-hp">${f.alive ? Math.ceil(f.hp) : '✕'}</span></div>`)
      .join('');
    q('#roster-a').innerHTML = `<div class="roster-title" style="color:${TEAM_CSS.attack}">${TEAMS.attack.name}</div>${roster('attack')}`;
    q('#roster-b').innerHTML = `<div class="roster-title" style="color:${TEAM_CSS.defend}">${TEAMS.defend.name}</div>${roster('defend')}`;

    this.drawMinimap(state);
  }

  /** The buy menu. open=true shows it; items come from match.buyCatalog. */
  renderBuy(open, items, money, onBuy) {
    const el = this.root.querySelector('#hud-buymenu');
    if (!open) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.innerHTML = `<div class="buy-title">BUY MENU — $${money}</div>` +
      items.map((it, i) => `<div class="buy-row ${money >= it.price ? '' : 'cant'}" data-id="${it.id}"><span class="buy-key">${i + 1}</span><span class="buy-name">${it.name}</span><span class="buy-price">$${it.price}</span></div>`).join('') +
      `<div class="buy-foot">Press 1–9 to buy, B or Esc to close. Round starts when the timer ends.</div>`;
    el.querySelectorAll('.buy-row').forEach((row) => {
      row.addEventListener('click', () => onBuy(row.dataset.id));
    });
  }

  /** The match-end scoreboard. */
  renderScoreboard(open, state) {
    const el = this.root.querySelector('#hud-scoreboard');
    if (!open) {
      el.style.display = 'none';
      return;
    }
    const rows = (team) => state.fighters
      .filter((f) => f.team === team)
      .sort((a, b) => b.kills - a.kills)
      .map((f) => `<div class="sb-row"><span>${f.name}</span><span>${f.kills} K</span><span>${f.deaths} D</span><span>$${f.money}</span></div>`)
      .join('');
    el.style.display = 'block';
    el.innerHTML = `<div class="sb-title">${state.match.matchWinner ? (state.match.matchWinner === 'attack' ? TEAMS.attack.name : TEAMS.defend.name) + ' WIN THE MATCH' : 'SCOREBOARD'}</div>
      <div class="sb-cols"><div class="sb-team"><div class="sb-team-name" style="color:${TEAM_CSS.attack}">${TEAMS.attack.name} — ${state.match.score.attack}</div>${rows('attack')}</div>
      <div class="sb-team"><div class="sb-team-name" style="color:${TEAM_CSS.defend}">${TEAMS.defend.name} — ${state.match.score.defend}</div>${rows('defend')}</div></div>
      <div class="sb-foot">IRONVEIL — Dockside Foundry · first to ${state.match.roundsToWin || 7} rounds</div>`;
  }
}
