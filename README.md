# Taccan

Taccan is a realtime Codenames-style multiplayer web app with a server-authoritative game engine.

## Features
- Create/join rooms by 4-character code.
- Team and role assignment (spymaster, operative, spectator).
- Team and role switching at any moment, including mid-game.
- Multiple players can share the same role on a team.
- Solo-play friendly: one connected player can start and play by switching team/role as needed.
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

Open `http://localhost:3000` in one or more browser tabs.

## Project layout
- `backend/server.js`: Socket.IO server, room/session lifecycle, game rules.
- `backend/words.js`: word bank for board generation.
- `frontend/index.html`: app shell.
- `frontend/style.css`: responsive styles and UI theme.
- `frontend/app.js`: realtime client logic and rendering.
