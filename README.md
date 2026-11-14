# Ember Yard — Tactical FPS

A round-based tactical first-person shooter built with three.js 0.187.0.
You are the attacker in the Ember Yard, a dusk-lit foundry yard. Plant the
charge at Furnace A (Site A) or eliminate all four Warden bots before the
clock runs out. Win rounds to earn money, buy better gear between rounds,
and take the match — first to 5 rounds.

## How to play

- **Objective:** Hold `E` inside the orange ring at Furnace A to plant the
  charge, then defend it for 35 seconds — or clear every Warden. If you are
  eliminated before planting, the round is lost. Wardens rush the site to
  defuse once the charge is live.
- **Money:** Kills pay $300, a round win $3,250, a loss $1,900. Spend it in
  the buy phase (press `B` or keys `1–5`) on the Kestrel VK-7 rifle,
  Spark Grenades, ammo and armor.
- **Gunplay:** Headshots deal up to 4× damage. Firing while moving or
  spraying widens your spread and kicks your aim up — stop, crouch or
  slow-walk (`Shift`) to land shots.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Aim (click the deploy button to lock the pointer) |
| Click | Fire |
| R | Reload |
| 1 / 2 / 3 | Falcon P9 pistol / Kestrel VK-7 rifle / Spark Grenade |
| C | Crouch |
| Shift | Slow-walk (accurate) |
| E (hold) | Plant the charge at Site A |
| B | Buy menu (between rounds) |

## Run it

Serve `game/` with any static server and open `index.html` in desktop
Chrome, e.g. `python3 -m http.server` from inside `game/`.

Screenshot demo states (for the maker's own screenshots only):
`?demo=cover`, `?demo=fight`, `?demo=site`, `?demo=buy`.
