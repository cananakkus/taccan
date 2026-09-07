# Taccan

A multiplayer word deduction game that runs entirely in the browser. Built on the mechanics of Codenames, Taccan brings the full experience online with real-time gameplay, built-in voice chat, and Turkish language support out of the box.

Two teams, a grid of words, one spymaster per side giving cryptic clues, and operatives trying to find their agents before the other team does. One wrong guess could reveal the assassin and end it all.

Live at [play.wleeaf.dev/taccan](https://play.wleeaf.dev/taccan).

## How it works

Open a room, share the four-letter code, and players join through their browser. No downloads, no accounts, no installation. Works on desktop and mobile.

Each round, the spymaster sees which words belong to which team and gives a one-word (or multi-word) hint along with a number. The operatives discuss and guess. Correct guesses reveal agents, wrong ones end the turn or worse. The team that finds all their agents first wins.

## Voice chat

Taccan includes peer-to-peer voice chat built on WebRTC. Since Discord is blocked in Turkey, this was not optional. Players can join voice directly from the game interface without any external application.

Background noise is handled by RNNoise, a recurrent neural network for noise suppression, running as a WebAudio worklet inside the browser. No server-side processing, no latency penalty.

For voice between different networks, configure a reachable TURN relay on the deployed backend with `TURN_HOST`, `TURN_USERNAME`, and `TURN_CREDENTIAL`. The host must serve TURN on port 3478 (UDP and TCP), with its relay port range open. For an existing Coturn relay using `use-auth-secret`, set `TURN_HOST` and `TURN_SHARED_SECRET` instead; the backend issues 24-hour signed credentials and never sends the shared secret to clients. The browser client fetches the configuration from `/taccan/api/turn-credentials`. STUN-only configuration cannot connect every pair of networks. A disconnect releases the microphone and resets voice; rejoin voice after the room reconnects.

`npm run test:e2e` builds the web client and runs Chromium tests for two-way audio, mute, voice rejoining, and spymaster clue visibility on desktop and phone layouts. Install the test browser with `npx playwright install chromium` first.


## Game modes

**Casual** is the standard format with no time pressure. **Blitz** adds configurable timers to both the hint and guess phases, forcing faster decisions.

## Features

- Room codes with shareable links and QR codes
- Team and role assignment: spymaster, operative, or spectator
- Roles and teams can be changed at any time, even mid-game
- Multiple players per role
- Host failover when the room creator disconnects
- Rematch with same teams or swapped sides, multi-round matches
- MVP voting after each game
- Session-based reconnect across browser refreshes
- Postgame debrief with a turn-by-turn narrative
- In-game chat and activity feed
- Card pattern overlays for accessibility
- Keyboard navigation and sound effects
- PWA installable
- Full Turkish and English localization, including all board words

## Running locally

```
npm install
npm start
```

The server starts at `http://127.0.0.1:3000`. To bind to all interfaces:

```
HOST=0.0.0.0 npm start
```

For development, run the API server and Vite client in separate terminals:

```sh
npm run dev:server
npm run dev:client
```

## Tests

```
npm test
```

The Node.js suite covers game rules, room/session lifecycle, payload validation, state persistence, voice signaling, and TURN credentials. Run `npm run test:unit` for frontend unit tests and `npm run test:e2e` for browser gameplay and voice tests.

## Architecture

The backend is Node.js with Express and Socket.IO. The browser client uses Vue 3, Pinia, TypeScript, and Vite. The former Flutter app was removed; it remains available in Git history before the removal commit.

All game state lives in memory on the server. Clients receive per-player state snapshots on every change. Spymasters see the keycard, operatives do not. The game engine uses a seeded Mulberry32 PRNG for deterministic, reproducible boards.

```
backend/
  server.js            Express app, Socket.IO wiring, cleanup
  server-helpers.js    Connection lifecycle, rate limiting, validation
  state-view.js        Per-player state snapshot construction
  timers.js            Phase timers and MVP timeout management
  room-lifecycle.js    Room creation, mode config, game rounds
  room-lock.js         Per-room action serialization
  game-engine.js       Pure game logic: boards, turns, guesses
  payload-schema.js    Event payload validation
  room-utils.js        Host failover, player pruning
  state-persistence.js State save and restore on shutdown
  words.js             Default word pool
  handlers/            Socket.IO event handler modules

frontend/
  index.html           Application shell
  style.css            Cold War dossier theme and responsive layouts
  translations.js      UI strings and word translations (EN/TR)
  public/              PWA assets and RNNoise worklet/WASM
  src/
    main.ts            Vue application entry point
    components/        Game view, controls, and room panels
    composables/       WebRTC voice lifecycle and audio processing
    stores/            Game snapshots, preferences, UI, and voice state
    lib/               Socket transport, storage, translations, and helpers
  dist/                Generated production bundle (not committed)
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| PORT | 3000 | Server listen port |
| HOST | 127.0.0.1 | Bind address |
| CORS_ORIGIN | https://play.wleeaf.dev | Allowed origins (comma-separated, or * for any) |
| BLITZ_HINT_TIMER_MS | 25000 | Blitz hint phase duration |
| BLITZ_GUESS_TIMER_MS | 35000 | Blitz guess phase duration |
| TURN_HOST | | TURN server hostname for voice relay |
| TURN_SHARED_SECRET | | Coturn REST shared secret; takes precedence over static credentials |
| TURN_USERNAME | | TURN server username (static authentication) |
| TURN_CREDENTIAL | | TURN server credential |
| ANTHROPIC_API_KEY | | Optional, for AI hint analysis |

## Deployment

The included Dockerfile builds a production image with Node 20 Alpine. Vite builds the frontend during the build stage. The final image contains the backend, compiled browser assets, and production dependencies.

```
docker build -t taccan .
docker run -p 3000:3000 -e HOST=0.0.0.0 taccan
```

## License

MIT
