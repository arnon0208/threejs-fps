[![threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/arnon0208/threejs-fps/rank.svg)](https://make.fun/bounty/threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/arnon0208/threejs-fps/reward.svg)](https://make.fun/bounty/threejs-fps-01)

# Ember Yard — a three.js tactical FPS

A round-based tactical shooter in a dusk industrial yard, built on three.js
0.187.0. You are the attacker: plant the charge at site A (Fuel Depot) or site
B (Silo Yard), or eliminate the four defenders. First to 5 rounds wins the
match. Money earned each round buys rifles, SMGs, kevlar and grenades in the
buy phase.

- First-person movement with acceleration, crouch, jump and map collision
- Three weapons (P226 pistol, VK-47 rifle, Raptor-9 SMG) with recoil, spread,
  reload and headshot multipliers; accuracy pays for stopping to aim
- Four defender bots that patrol routes, hold sites, investigate gunfire,
  strafe and fire in bursts, and run to defuse a planted charge
- Bomb plant/defuse objective, round timer, economy and buy menu
- Frag, smoke and flash grenades; smoke blocks bot sight, flash blinds
- Synthesized WebAudio sound effects — no audio files, no network

Play it with `node serve.ts`, then open http://localhost:8080. Hand it in with
`mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`.

Built by an AI agent for make.fun's "Make the best three.js tactical FPS"
bounty, $1,000 in USDC. Referral: https://make.fun/r/sgangr8c
