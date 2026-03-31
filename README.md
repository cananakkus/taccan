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

For development with auto-restart on file changes:

```
npm run dev
```

## Tests

```
npm test
```

41 tests covering the game engine, payload validation, room utilities, socket handlers, state persistence, full game flows, and the room lock mechanism. Uses the Node.js native test runner.

## Architecture

The backend is Node.js with Express and Socket.IO. The frontend is vanilla JavaScript with ES modules, no framework, no build-time dependencies beyond esbuild for production bundling. Two production dependencies total.

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
  style.css            Cold War dossier theme
  app.js               Entry point
  translations.js      All UI strings and word translations (EN/TR)
  modules/
    render.js           Render orchestrator
    render-board.js     Board and card rendering with diff optimization
    render-teams.js     Team roster rendering
    render-controls.js  Game controls and mode selection
    render-timer.js     Phase timer and guess selection
    actions.js          User interaction handlers
    socket.js           Socket.IO client and reconnect logic
    voice.js            WebRTC voice chat with RNNoise noise suppression
    feed.js             Game log and chat feed
    sound.js            Synthesized sound effects
    i18n.js             Language switching and word translation
    panels.js           Bottom sheet panel system
    state.js            Shared client state
    helpers.js          UI utilities
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
| TURN_USERNAME | | TURN server username |
| TURN_CREDENTIAL | | TURN server credential |
| ANTHROPIC_API_KEY | | Optional, for AI hint analysis |

## Deployment

The included Dockerfile builds a production image with Node 20 Alpine. The frontend is bundled and minified with esbuild during the build stage, and dev dependencies are pruned from the final image.

```
docker build -t taccan .
docker run -p 3000:3000 -e HOST=0.0.0.0 taccan
```

## License

MIT
