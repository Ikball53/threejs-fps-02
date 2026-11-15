[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Ikball53/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Ikball53/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

# CINDERLINE — Foundry Yard

A round-based tactical FPS for [make.fun's "Make the best three.js tactical FPS" bounty](https://make.fun/bounty/threejs-fps-02).

You are Ember, the attacker, with four bot teammates. Fight the Slate crew
across the Foundry Yard, plant the Igniter at the Reactor, or wipe the
other team. First to 7 rounds takes the match.

## How it plays

- **Rounds and objective:** 12-second buy phase, 100-second rounds. Plant the
  Igniter at the Reactor (hold E inside the site, 3 seconds), defend the
  35-second fuse, or eliminate the whole Slate team. Slate wins by holding
  the site, defusing (5 seconds), or running the clock out.
- **Economy:** $800 to start, +$300 per kill, +$3,250 for a round win,
  +$1,900 for a loss (plus a loss-streak bonus). Press B in the buy phase
  to shop: five weapons, Kevlar armor, and flash / smoke / HE grenades.
- **Gunplay:** hitscan with headshots worth double, recoil and spread that
  punish firing on the move, crouching and aiming to steady the shot,
  acceleration-based movement with wall collision and jumping.
- **Bots:** nine bots walk waypoint routes, hold angles, rotate to the
  planted Igniter, investigate gunfire they hear, and go blind to flashbangs.
  Smoke clouds block their line of sight.
- **HUD:** health, armor, ammunition, money, round timer, score, team
  pips, kill feed, hitmarkers, plant progress, and a buy menu.

## How it works

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to `$MAKEFUN_OUTPUT_DIR` (default `/output`) and writes `dossier.json`
with the kit's `buildDossier`. It creates directories and never deletes
anything.

The game is static ES modules under `game/` on three.js 0.187.0 (vendored
byte for byte under `game/vendor/three/`). The simulation runs on a fixed
60 Hz step kept apart from rendering; one module owns one job:
`boot.js` (renderer, input, wiring), `sim.js` (rounds and economy),
`state.js` (the single state store), `map.js` (the yard, colliders, routes),
`mover.js` (physics), `arms.js` (weapons and grenades), `bots.js` (AI),
`fx.js` (tracers, sparks, smoke), `sfx.js` (synthesized WebAudio),
`hud.js` (HUD and buy menu), `shots.js` (screenshot staging).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# then serve out/game and open index.html in desktop Chrome
python3 -m http.server 8123 --directory out/game
```

Or serve the repo's `game/` directly and play it the same way.

## License

MIT. See `LICENSE`.
