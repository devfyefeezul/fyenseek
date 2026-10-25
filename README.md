# HidenSeek

Hide and seek for your phone. Make a room, share the 6-letter code, and play with up to 8 friends. Hiders turn into furniture and kitchen stuff; one seeker has 3 minutes to find them all.

- Portrait phone layout: joystick on the left, buttons on the right, all in the bottom third.
- Cute isometric 3D, using free [KayKit](https://kaylousberg.itch.io/) models (CC0).
- Runs for free: one small Node server holds every room.

## How a round works

| Phase | Time | Seeker | Hiders |
| --- | --- | --- | --- |
| Get ready | 10 s | Sees their role | See their role |
| Hide | 1 min (30 s to 1.5 min) | Eyes closed (black screen) | Walk around, **Swap** into an object, **Lock** in place |
| Seek | 3 min (2 to 5 min) | Tap a suspicious object, press **Tag** | Stay still, or sneak and re-swap |
| Results | 15 s | Scores | Scores |

- Tagging a real object costs the seeker **5 seconds**.
- From 1 minute left, every hider plays a little tune every 20 seconds. At 30 seconds left, hiders flash once.
- Hiders can press **Taunt** for bonus points (and risk).
- Found hiders watch the rest of the round.
- By default everyone gets one turn as seeker. The host can change rounds, timers and seeker order in the lobby.

**Scoring:** seeker +100 per find, +50 per 30 s left if they find everyone. Hiders +10 per 10 s survived, +150 for never being found, +25 per taunt.

### Controls

| Action | Phone | Keyboard |
| --- | --- | --- |
| Move | Joystick (push gently to sneak) | WASD or arrows (Shift to sneak) |
| Pick an object | Tap it (nearest one is picked for you) | Click it |
| Swap / Lock / Rotate / Taunt | Buttons | E / F / R / T |
| Tag (seeker) | Tag button | Space |

## Run it on your computer

You need [Node.js 20 or newer](https://nodejs.org/).

```bash
npm install
npm run dev
```

Open http://localhost:5173. To play from phones on the same Wi-Fi, open `http://<your-computer's-IP>:5173` on each phone (Vite prints the address as "Network").

To run it the way it runs online:

```bash
npm run build
npm start          # http://localhost:3000
```

## Put it online for free

The website goes on **Vercel** and the game server on **Render**. Vercel can't keep a game server running between requests, so the two work together. Both are free.

### 1. Game server on Render

1. Sign in to [render.com](https://render.com) with GitHub (no card needed for the free plan).
2. **New > Blueprint**, pick this repo. Render reads `render.yaml` and starts a service called `fyenseek-server`.
3. When it's live, check its address. It should be `https://fyenseek-server.onrender.com`. If Render gave a different one, put it in `.env.production` (`VITE_SERVER_URL=wss://<that address>`) and push.

The free server sleeps after about 15 minutes without players. The website wakes it when someone opens the page, and the first visitor waits up to a minute.

### 2. Website on Vercel

1. In Vercel, **Add New > Project** and import this repo.
2. Keep the defaults. `vercel.json` already sets the build command and output folder.
3. Deploy, then share the Vercel address, for example `https://fyenseek.vercel.app`. Room links look like `https://fyenseek.vercel.app/r/K7QF2M`.

Every push to `main` redeploys both.

### Alternative: one server, no Vercel

The Render service also serves the website itself, so `https://fyenseek-server.onrender.com` works on its own. For a server that never sleeps, use an Oracle Cloud Always Free VM with the included `Dockerfile`:

```bash
docker build -t hidenseek .
docker run -d --restart unless-stopped -p 80:3000 hidenseek
```

## Project layout

```
src/shared/   rules shared by server and browser
  constants.ts  timers, ranges, scoring
  props.ts      every object, its size and whether you can turn into it
  map.ts        Cozy House floor plan and prop placement
  movement.ts   movement and collision (same code on both sides)
  protocol.ts   messages between browser and server
src/server/   Node server (Express + WebSocket)
  room.ts       lobby, phases, swapping, tagging, scoring
  index.ts      room codes, connections, 20 ticks per second
src/client/   browser game (Vite + Three.js)
  main.ts       screens, HUD, game loop
  world.ts      isometric 3D scene
  controls.ts   joystick and keyboard
src/client/public/models   KayKit models (CC0)
tests/        rule tests and a 3-phone browser test
```

The server decides everything (movement, swaps, tags, timers). The seeker's browser never receives which object is which player: hiders get a new random id each round in the seeker's view.

## Tests

```bash
npm test                    # map and game-rule tests
npm run build && npm start  # then, in another terminal:
npm run e2e                 # 3 simulated phones play through a round (needs Playwright)
```

## Adding a map

Add a `MapDef` to `src/shared/map.ts` (rooms, walls with door gaps, props), add it to `MAPS`, and add an option to the map list in `src/client/index.html`. `npm test` checks that props don't overlap walls and that every hiding spot can be reached. New models go in `src/client/public/models/`; run `npm run props` to measure them.

## Credits

3D models: [KayKit Furniture Bits and Restaurant Bits](https://kaylousberg.itch.io/) by Kay Lousberg, CC0 (see `src/client/public/models/LICENSE-KayKit.txt`).
