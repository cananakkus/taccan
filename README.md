# Murmur

A multiplayer word deduction game that runs entirely in the browser. Built on the mechanics of Codenames, Murmur brings the full experience online with real-time gameplay, built-in voice chat, and Turkish language support out of the box.

Two teams, a grid of words, one spymaster per side giving cryptic clues, and operatives trying to find their agents before the other team does. One wrong guess could reveal the assassin and end it all.

The application is served under `/murmur/`. Production is [play.wleeaf.dev/murmur/](https://play.wleeaf.dev/murmur/).

## How it works

Open a room, share the four-letter code, and players join through their browser. No downloads, no accounts, no installation. Works on desktop and mobile.

Each round, the spymaster sees which words belong to which team and gives a one-word (or multi-word) hint along with a number. The operatives discuss and guess. Correct guesses reveal agents, wrong ones end the turn or worse. The team that finds all their agents first wins.

## Voice chat

Murmur includes peer-to-peer voice chat built on WebRTC. Since Discord is blocked in Turkey, this was not optional. Players can join voice directly from the game interface without any external application.

Background noise is handled by RNNoise, a recurrent neural network for noise suppression, running as a WebAudio worklet inside the browser. No server-side processing, no latency penalty.

For voice between different networks, configure a reachable TURN relay using either the shared Wleeaf voice broker or local `TURN_HOST` and `TURN_SHARED_SECRET`. The host must serve TURN on port 3478 (UDP and TCP), with its relay port range open. Static `TURN_USERNAME` and `TURN_CREDENTIAL` remain compatible with older relay installations; shared-secret authentication is preferred because static credentials cannot expire per player.

`voice:join` verifies the current room membership and returns the peer list and ICE configuration together. `voice:credentials` renews that configuration only for a current voice member. Derived credentials last ten minutes by default, identify an opaque room/participant scope, and renew before expiry without releasing the microphone. A temporary renewal failure retries while the current credential remains valid; expiry closes the call if renewal still fails. The HTTP `/murmur/api/turn-credentials` compatibility route returns only public STUN servers. Relay failures are reported instead of silently falling back to STUN. STUN-only configuration cannot connect every pair of networks. A socket disconnect releases the microphone and resets voice; rejoin voice after the room reconnects.

The independent broker lives in the sibling Wleeaf Play repository at `play/platform/voice/`. Set `VOICE_SERVICE_URL=http://play-voice:3200` and `VOICE_SERVICE_KEY` on the backend to use it. Both values are required together. In broker mode, this game needs no Coturn signing secret. The broker stays on the private Docker network and authenticates each game with a separate key. See [the Wleeaf platform runbook](../../wleeaf/play/platform/README.md) for its configuration and rollout.

Voice remains free. The server adapter in `backend/voice-infrastructure.js` accepts an `authorizeVoice` function through `createApp`. Its context contains the current room and participant IDs plus the verified accounts of connected room members, including members outside the call. This is the extension point for future room-wide premium coverage: any one entitled account can cover everyone in the room, including guests. Entitlements must come from a trusted account service. Browser payloads and saved account IDs never grant coverage. Policy is checked on join and credential renewal; billing and active-call premium revocation are separate future work. Peer-to-peer media cannot be forcibly stopped solely by revoking signaling or TURN credentials.

## Wleeaf accounts

The optional `/account/client.js` SDK comes from the shared Play gateway. Its `session('taccan')` exchange supplies a five-minute signed proof; the historical audience remains `taccan` after the rename. Configure the matching `PLAY_ACCOUNT_SECRET` in this backend. Keycloak continues to own registration, passwords, verification and recovery. This game never receives provider refresh tokens or stores passwords.

Signed-in players use their verified account name and own their room seat. `account:refresh` renews the proof on the existing socket before expiry, preserving the room and voice call. It cannot switch to a different identity. If the account gateway is temporarily unavailable, refresh retries while the current proof remains valid; the server closes the connection when an unrenewed proof expires. A failed initial account exchange reports a connection failure and retries instead of silently changing an authenticated player into a guest. Standalone deployments without the SDK still support guests normally.

`npm run test:e2e` builds the web client and runs Chromium tests for two-way audio, mute, voice rejoining, and spymaster clue visibility on desktop and phone layouts. Install the test browser with `npx playwright install chromium` first.


## Game modes

**Casual** is the standard format with no time pressure. **Blitz** adds configurable timers to both the hint and guess phases, forcing faster decisions.

## Features

- Room codes with shareable links and QR codes
- Team and role assignment: spymaster, operative, or spectator
- Roles and teams can be changed at any time, even mid-game
- Multiple operatives per team, with one spymaster seat per team
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

The server starts at `http://127.0.0.1:3000`. Use `PORT=3080 npm start` if port 3000 is occupied. To bind to all interfaces:

```
HOST=0.0.0.0 npm start
```

For LAN play, bind to all interfaces and open the game using the server’s LAN address; copied invitations use that address. A localhost invite only works on the same machine. Public play requires a reachable HTTPS host; browsers require a secure context for microphone access.

For development, run the API server and Vite client in separate terminals:

```sh
npm run dev:server
npm run dev:client
```

## Tests

```
npm test
```

The Node.js suite covers game rules, room/session lifecycle, payload validation, state persistence, voice signaling, and TURN credentials. Run `npm run typecheck` to check TypeScript and Vue templates, `npm run test:unit` for frontend unit tests, and `npm run test:e2e` for browser gameplay and voice tests. Tests use isolated state so they do not consume saved rooms.

## Play party

With `PARTY_SECRET` set, the private `/_party/matches` API lets the Play party service (play.wleeaf.dev) create tournament rooms of four to eight seats. Seats alternate red/blue and the first two are the spymasters. [PARTY.md](PARTY.md) describes the full integration.

### Bots

Roster entries may be bots: `{id, name, color, bot: true, skill: "easy" | "normal" | "hard"}`. A missing `skill` means `normal`. Every roster needs at least one human, names are at most 18 characters, and invalid `bot` or `skill` values are rejected. The server plays every bot seat itself:

- Bots are always listed in `connected`, count as ready, and the round starts once the humans connect. `POST .../join` for a bot returns 400 `Bots cannot be joined`, and the socket rejoin rejects bot seats. Bots are never host.
- **Spymaster bots** read the keycard and score every clue in a bundled offline association table (`backend/bot-associations.js`: about 500 clues covering every board word). Each clue is scored by the team's words it covers minus the opponent, neutral and assassin words it also hits. Clues that are board words, contain one or share its stem are never given.
- **Operative bots** see only what a human operative sees: the words, revealed cards and clues. They rank unrevealed cards by how strongly the clue points at them, through a direct table link, plurals and stems, or co-occurrence when the clue is itself a board-vocabulary word. That last rule lets them follow many human clues. A bot always makes at least one guess, guesses up to the clue's number while the links stay strong, and then ends the turn.
- **Skill.** *Easy* knows about 60% of the links, ranks noisily, gives clues for at most 2 words, often settles for 1, ignores most risk and sometimes stops early. *Normal* knows 88%, never knowingly points at the assassin and caps clues at 3. *Hard* knows every link, only gives clues that avoid the assassin and the opponent (up to 4 words), and uses the bonus guess on words left over from its team's earlier clues. In offline bot-vs-bot rounds, hard beats easy about 98% of the time and normal about 80%; easy teams hit the assassin in roughly a third of their rounds.
- **Timing.** A clue takes 1.2 to 3 s and each guess 0.7 to 2.2 s. When a human operative shares the turn, the bot first marks its preferred card as a suggestion. It guesses only after its teammates have been idle for 20 s, so humans lead without the turn stalling. `BOT_DELAY_SCALE` scales all of these delays; tests use 0.01.
- **Persistence and forfeits.** The `bot` and `skill` flags are stored in the persisted match payload and on the player snapshot. After a restart, bots come back connected and carry on. If the last human forfeits, a team left with fewer than two players loses at once as before. Otherwise the remaining bots finish the round immediately on the server. The result is a draw only if that cannot finish. Results may name bot ids as winners.
- The UI shows a small **BOT** tag, with the skill in its tooltip, next to bot names in the team rosters and spymaster slots.

## Architecture

The backend is Node.js with Express and Socket.IO. The browser client uses Vue 3, Pinia, TypeScript, and Vite. The former Flutter app was removed; it remains available in Git history before the removal commit.

All game state lives in memory on the server. Clients receive per-player state snapshots on every change. Spymasters see the keycard, operatives do not. The game engine uses a seeded Mulberry32 PRNG for deterministic, reproducible boards.

Graceful shutdown saves rooms to `STATE_FILE`; an abrupt crash loses changes since the last shutdown. The Compose configuration stores snapshots in a named volume and restores them on restart. Run a single server instance; room state and connections are not shared between replicas.

Guest reconnects require a private proof stored in the browser, separate from public player IDs. Older guest sessions without that proof must join again after upgrading.

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
  turn-actions.js      Clue, guess, mark and end-turn state changes (humans and bots)
  party-adapter.cjs    Private Play party match API (SQLite)
  party-support.js     Party rooms: seats, forfeits, results
  bots.js              Party bot clue/guess logic and scheduling
  bot-associations.js  Offline clue-to-word association table
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
| VOICE_SERVICE_URL | | Private shared credential broker URL; configured together with its key |
| VOICE_SERVICE_KEY | | Backend-only key for this game's broker application (`taccan`) |
| VOICE_CREDENTIAL_TTL_SECONDS | 600 | Local dynamic credential lifetime, 120–3600 seconds; broker mode uses the broker's TTL |
| PLAY_ACCOUNT_SECRET | | Signing secret for optional wleeaf account sessions |
| STATE_FILE | .taccan-state.json in the project root | Room snapshot written during graceful shutdown |
| PARTY_SECRET | | Enables the private Play party API (at least 32 characters) |
| PARTY_DATA_FILE | state/party.sqlite | SQLite store for party matches |
| BOT_DELAY_SCALE | 1 | Multiplier for party bot thinking delays |

## Deployment

The included Dockerfile builds a production image with Node 22 Alpine. Vite builds the frontend during the build stage. The final image contains the backend, compiled browser assets, and production dependencies. It runs as the non-root `node` user, binds to all container interfaces, and includes a health check.

```
docker compose up --build -d
# Choose a different host port if 3000 is in use:
PORT=3080 docker compose up --build -d
# Stop the game while retaining saved rooms:
docker compose down
```

## License

MIT

The public name is Murmur (formerly Wordmurmur and Taccan). Existing `/wordmurmur/` and `/taccan/` links redirect to `/murmur/`; legacy API and socket paths remain compatible with open games. Internal Docker service, account audience, TURN configuration, and browser storage keys retain their existing identifiers to preserve rooms and preferences. The PWA keeps its original install ID while moving its start URL and scope.

Repository paths: local `clone-games/murmur/`, deployed source `/opt/wleeaf/wordmurmur/`, Gitea `taceddin/wordmurmur`. The Compose service is still `taccan` for runtime compatibility. GitHub remains `cananakkus/taccan` until its owner renames it; the connected `wleeaf` account has write access but no administration permission. After the owner renames it, update the `github` remote to `https://github.com/cananakkus/murmur.git`.

Room entry uses one button: leave the room code empty to create a room, or enter a code to join it. Hint counts must be integers from 1 to the configured maximum. Colorblind patterns cover each known card; card type symbols are omitted.

Opened cards have a diamond marker visible only to spymasters. Operatives can click a selected card again to deselect it; guesses require the submit button. New clues appear in a framed box and play a sound when effects are enabled. The navbar keeps its call controls in a compact green panel. Player lists show microphone status, animated speaking indicators, and individual volume sliders. Voice status is visible to everyone in the room, including people outside the call. Only the built-in word list is supported; custom word URLs have been removed.
