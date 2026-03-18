# Taccan

Multiplayer Codenames on the web. Node.js backend, vanilla frontend, Socket.IO for realtime state sync.

Live at [play.wleeaf.dev/taccan](https://play.wleeaf.dev/taccan).

## Game modes

| Mode | Description |
|---|---|
| Casual | Standard Codenames rules |
| Blitz | Timed hints and guesses |
| Cipher | Spymaster hints must be anagrams of a board word |
| Blackout | Words disappear after 10 seconds |

## Features

- 4-character room codes with shareable links
- Team/role assignment: spymaster, operative, spectator
- Switch teams or roles at any time, including mid-game
- Multiple players per role, solo-play friendly
- Host failover on disconnect, host prune controls
- Rematch (same teams or swap sides), multi-round matches with MVP votes
- Reconnect with browser session restore
- Spymaster keycard hidden until game end
- Voice chat (WebRTC peer-to-peer)
- Game log, scratchpad, hint history
- Postgame debrief narrative
- PWA installable, keyboard navigation, sound effects, colorblind mode
- i18n (English, Turkish)
- Cold War dossier theme (Playfair Display SC, Special Elite, Crimson Pro)

## Run locally

```bash
npm install
npm start
```

Open `http://127.0.0.1:3000`. For LAN/container access:

```bash
HOST=0.0.0.0 npm start
```

Dev mode with auto-restart:

```bash
npm run dev
```

## Test

```bash
npm test
```

Uses Node.js native test runner (`node --test`).

## Project layout

```
backend/
  server.js          Express + Socket.IO server, room/session lifecycle
  game-engine.js     Pure game state: board generation, turns, guesses
  payload-schema.js  Socket event payload validation
  room-utils.js      Host failover, player pruning, room helpers
  words.js           Word bank

frontend/
  index.html         App shell
  style.css          Theme and responsive layout
  app.js             Entry point, bootstraps modules
  translations.js    i18n strings (EN/TR)
  sw.js              Service worker (PWA)
  manifest.json      PWA manifest
  modules/
    state.js         Shared mutable state
    ui.js            DOM element references
    render.js        UI rendering from server snapshots
    actions.js       User interaction handlers
    socket.js        Socket.IO event wiring
    sound.js         Sound effects engine
    voice.js         WebRTC voice chat
    debrief.js       Postgame narrative generator
    i18n.js          Translation helpers
    helpers.js       Shared utilities
    identity.js      Player identity persistence
    keyboard-nav.js  Keyboard navigation
    haptics.js       Vibration feedback
    qrcode.js        Room QR code generator
    room-seal.js     Decorative room seal SVG
    scratchpad.js    Operative notes
    state-machine.js Client-side state machine
    voice-hints.js   Voice chat UI hints
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `CORS_ORIGIN` | — | Allowed CORS origin |
| `BLITZ_HINT_TIMER_MS` | — | Blitz mode hint timer |
| `BLITZ_GUESS_TIMER_MS` | — | Blitz mode guess timer |
| `BLITZ_HINT_MAX` | — | Max hints in blitz mode |

## Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "backend/server.js"]
```

## License

MIT
