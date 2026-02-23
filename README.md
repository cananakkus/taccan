# Taccan

Taccan is a realtime Codenames-style multiplayer web app with a server-authoritative game engine.

## Features
- Create/join rooms by 4-character code.
- Team and role assignment (spymaster, operative, spectator).
- Team and role switching at any moment, including mid-game.
- Multiple players can share the same role on a team.
- Solo-play friendly: one connected player can start and play by switching team/role as needed.
- Automatic host failover to a connected player if the host disconnects.
- Host control to prune disconnected players from a room immediately.
- Host rematch controls (`same teams` or `swap sides`) after each finished round.
- Full Codenames turn loop:
  - spymaster hint (`word + number`)
  - operative guesses (`number + 1`, or unlimited when `0`)
  - turn switching on neutral/opponent card
  - assassin instant loss
- Reconnect support with local browser session restore.
- Role-based information visibility (keycard only for spymasters until game end).

## Requirements
- Node.js 18+

## Run locally
```bash
npm install
npm run start
```

Open `http://127.0.0.1:3000` in one or more browser tabs.

To expose on all interfaces (for LAN/container setups), run:
```bash
HOST=0.0.0.0 npm run start
```

## Test
```bash
npm test
```

## Project layout
- `backend/server.js`: Socket.IO server, room/session lifecycle, game rules.
- `backend/game-engine.js`: pure game state transitions and board generation.
- `backend/payload-schema.js`: centralized event payload validation.
- `backend/room-utils.js`: room host/failover, connected counts, and disconnected-player pruning helpers.
- `backend/words.js`: word bank for board generation.
- `frontend/index.html`: app shell.
- `frontend/style.css`: responsive styles and UI theme.
- `frontend/app.js`: realtime client logic and rendering.

## Notes
- `taccan.md` is the product/architecture plan and roadmap.
- The current implementation is a single Node.js process with in-memory room state and a static frontend.
- Planning docs:
  - `problems.md`: creative product/design/architecture review
  - `execution-backlog.md`: prioritized now/next/later execution plan
  - `tickets-now.md`: implementation-ready ticket list for the current sprint window
  - `dependency-milestones.md`: feature dependency graph and milestone sequencing
  - `feature-spec-top3.md`: implementation specs for top 3 upcoming features
  - `rfc-scaling-and-state.md`: scaling and protocol evolution RFC
