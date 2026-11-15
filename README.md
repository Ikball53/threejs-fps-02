[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Ikball53/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Ikball53/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

# IRONVEIL — Dockside Foundry

A complete round-based three.js tactical FPS, built for the [make.fun threejs-fps-02 bounty](https://make.fun/bounty/threejs-fps-02).

Two teams of five fight over a dockside foundry. Rustjackets attack, Harbour Watch defends. First team to 7 rounds wins the match.

## The game

- **Full tactical loop** — buy phase, freeze phase, live rounds, match end. Rounds are won by elimination, by detonating the planted device, by defusing it, or by holding the site until the clock runs out.
- **Two plant sites** — Furnace Hall (west) and Crane Yard (east), with an elevated catwalk, a ramp, and loading docks you step onto.
- **Economy** — kills pay $300, round wins pay $3,250, and a losing streak pays a growing bonus so a team can buy back in. The buy menu sells five rifles and SMGs, a sniper, a shotgun, three grenade types, kevlar, a helmet and a defuse kit.
- **Gunplay** — six weapons, each with its own recoil pattern, spread that grows with movement, airtime and sustained fire, damage falloff with distance, headshot multipliers, armour, and aim-down-sights zoom.
- **Movement** — Quake-style acceleration and friction, air control, jumping, crouching, and step-up ledges.
- **Bots with roles** — entry fraggers, support, a lurker, anchors and a sniper. They plan with A* over a navigation graph with smoothed paths, hold angles, react to gunfire and to seeing enemies, investigate sounds, plant and defuse, and avoid smoke. Smoke genuinely blocks their vision; a flashbang genuinely blinds them.
- **Grenades** — flash, smoke (14 seconds of real vision-blocking cover), and high-explosive with distance and cover falloff.
- **HUD** — canvas minimap with live dots, team rosters, kill feed, hurt-direction indicator, health and armour, ammunition, round score and timer, dynamic crosshair, and a full match-end scoreboard.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim (click the window to capture it) |
| WASD | Move |
| Shift | Walk |
| Ctrl / C | Crouch |
| Space | Jump |
| Left click | Fire |
| Right click | Aim down sights |
| R | Reload |
| 1 / 2 | Primary / sidearm |
| Q | Cycle grenade |
| G | Throw grenade |
| E (hold) | Plant / defuse |
| B | Buy menu |
| Tab | Scoreboard |

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

Hand the entry in with `node main.ts` (set `MAKEFUN_OUTPUT_DIR` outside the grader). The screenshots in `screenshots/` are real renders of the game, staged with `?shot=cover|fight|site|buy&seed=1`.

## Layout

- `main.ts` — the program that copies the game and screenshots to the output directory and writes `dossier.json`.
- `game/index.html` — the page, with the three.js import map.
- `game/src/` — the game: `rng` (seeded randomness), `arena` (map, collision, A*), `guns` (weapons and economy items), `fighters` (figures and bot brains), `match` (rounds and money), `fx` (tracers, smoke, explosions), `hud` (minimap, menus, scoreboard), `engine` (fixed-step simulation and rendering), `boot` (startup and staged shots).
- `game/vendor/three/` — three.js 0.187.0, unchanged from the kit.
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged.
