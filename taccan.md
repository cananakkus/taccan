# Taccan: Codenames Clone

## 1. Scope and Objectives
- Build a web-based multiplayer Codenames clone for 4+ players.
- Support public and private rooms, team assignment, and spectator mode.
- Enforce official Codenames rules in the game engine (turn flow, hints, guesses, assassin, win conditions).
- Provide low-latency real-time updates for all players.
- Keep architecture modular so future variants (timed mode, custom card packs, AI bot) are easy to add.

## 2. Core Product Requirements
- Room creation and join by room code.
- Roles:
  - Spymaster (one per team)
  - Operative/Guesser (one or more per team)
  - Spectator (read-only)
- Board generation:
  - 25 unique words from a dictionary.
  - Hidden keycard with red/blue/neutral/assassin mapping.
  - Starting team gets 9 words; other team gets 8.
- Turn system:
  - Spymaster submits one-word hint + number.
  - Operatives can guess up to `number + 1` words.
  - Wrong team/neutral ends turn.
  - Assassin triggers immediate loss.
- Visibility rules:
  - Spymasters can view keycard.
  - Operatives/spectators cannot see hidden colors until revealed.
- End conditions:
  - Team reveals all their words -> win.
  - Team reveals assassin -> immediate loss.

## 3. High-Level Architecture
Use a client-server architecture with authoritative game state on the server.

### 3.1 Components
- Frontend (SPA)
  - Lobby/room UI, board UI, role-specific controls.
  - WebSocket client for real-time updates.
- Backend API + WebSocket server
  - Room lifecycle, player session management.
  - Authoritative game engine and rule validation.
  - Broadcast state snapshots/events.
- Persistence layer
  - Lightweight DB for users, room metadata, stats, and word packs.
  - In-memory cache/store for active room state.

### 3.2 Recommended Stack
- Frontend: TypeScript + React + Vite
- Realtime: Socket.IO (or native WebSocket with a typed protocol)
- Backend: Node.js + Fastify/Express + TypeScript
- DB: PostgreSQL
- Cache/state: Redis (optional initially; required for horizontal scale)
- Infra: Docker + Docker Compose for local dev, then container deployment

## 4. Domain Model
- `User`
  - id, display_name, created_at
- `Room`
  - id, code, status (`lobby|in_game|finished`), created_by, created_at
- `RoomPlayer`
  - room_id, user_id, team (`red|blue|none`), role (`spymaster|operative|spectator`), connected
- `Game`
  - room_id, current_turn_team, phase (`hint|guess|resolved|finished`), remaining_red, remaining_blue
- `BoardCard`
  - game_id, index, word, hidden_color (`red|blue|neutral|assassin`), revealed
- `Turn`
  - game_id, turn_no, team, hint_word, hint_count, guesses_made, ended_by

## 5. Backend Design

### 5.1 Service Boundaries
- `RoomService`
  - create/join/leave room, assign teams/roles.
- `GameService`
  - start game, generate board/keycard, run turn transitions.
- `RuleEngine`
  - pure deterministic functions for move validation and state transitions.
- `RealtimeGateway`
  - socket auth, room channels, event fanout.

### 5.2 API Surface (minimal)
- `POST /rooms` -> create room
- `POST /rooms/:code/join` -> join room
- `POST /rooms/:code/start` -> start game (host/spymaster only)
- `GET /rooms/:code/state` -> initial state sync

### 5.3 Realtime Events
Client -> server:
- `room:join`
- `room:leave`
- `team:set`
- `role:set`
- `game:start`
- `turn:hint_submit` (`word`, `count`)
- `turn:guess` (`cardIndex`)
- `turn:end`

Server -> client:
- `state:full`
- `player:joined`
- `player:left`
- `game:started`
- `turn:hint_accepted`
- `turn:guess_resolved`
- `turn:ended`
- `game:finished`
- `error:rule_violation`

### 5.4 Rule Validation (server-authoritative)
- Validate actor role/team/turn before every action.
- Reject duplicate guesses and already revealed cards.
- Enforce one-word hint constraint (basic lexical checks at MVP).
- Persist turn log for replay/debug.

## 6. Frontend Design

### 6.1 Pages/Views
- Home: create/join room.
- Room Lobby: player list, team/role assignment, start controls.
- Game Board:
  - 5x5 grid of cards
  - Hint panel
  - Guess controls
  - Turn/status banner
- Post-game summary.

### 6.2 State Management
- Keep server as source of truth.
- Client store (Zustand/Redux) for:
  - local user/session
  - latest room/game snapshot
  - transient UI state (modals, toasts)

### 6.3 UX Constraints
- Clearly separate spymaster and operative views.
- Show optimistic loading states, but not optimistic gameplay actions.
- Auto-reconnect socket and request `state:full` resync after reconnect.

## 7. Realtime and Scaling Strategy
- MVP: single backend instance with in-memory room state.
- Scale-up path:
  - move room/game state to Redis.
  - use socket adapter (e.g., Socket.IO Redis adapter) for multi-instance broadcasts.
  - sticky sessions at load balancer if required by transport.

## 8. Security and Abuse Controls
- Use short-lived session token per room join.
- Validate all payloads with schema validator (Zod/JSON Schema).
- Basic rate limits on room creation/join and gameplay events.
- Sanitize display names and hints to prevent XSS in logs/UI.

## 9. Testing Strategy

### 9.1 Unit Tests
- `RuleEngine` exhaustive tests:
  - legal/illegal hint submit
  - guess resolution for all color outcomes
  - turn switching and win/loss conditions

### 9.2 Integration Tests
- API tests for room lifecycle.
- Socket tests for event flow and authorization.

### 9.3 End-to-End Tests
- Full happy path match.
- Reconnect during active game.
- Assassin click immediate loss path.

### 9.4 Non-Functional
- Load test active rooms and socket throughput.
- Chaos test disconnect/reconnect storms.

## 10. Implementation Plan

### Phase 0: Foundations
- Initialize monorepo (`frontend`, `backend`, shared `types`).
- Configure TypeScript, linting, formatting, and test runners.
- Define shared event and domain types.

### Phase 1: Lobby + Room Management
- Build create/join room flow.
- Implement socket presence and lobby state broadcast.
- Add team/role assignment rules.

### Phase 2: Core Game Engine
- Implement board generator and turn machine in `RuleEngine`.
- Add server actions for hint submit, guess, and turn end.
- Broadcast deterministic state updates.

### Phase 3: Playable UI
- Implement role-aware board UI.
- Add hint/guess controls and result animations.
- Add game-end modal and play-again flow.

### Phase 4: Persistence + Reliability
- Persist users, room history, and match summaries in PostgreSQL.
- Add reconnect/resync logic and durable event logging.

### Phase 5: Hardening + Release
- Add rate limiting, payload validation, and error telemetry.
- Run load tests and fix bottlenecks.
- Containerize and deploy v1.

## 11. Definition of Done (v1)
- Two teams can complete a full game in real time with correct rules.
- Reconnect restores correct game state.
- No client can bypass turn/role restrictions.
- Critical paths covered by automated tests.
- Basic production deployment with logs and health checks.

## 12. Post-v1 Roadmap
- Custom dictionaries and language packs.
- Ranked mode and player stats.
- Bot teammate/opponent using LLM or heuristic model.
- Timed competitive mode and tournament brackets.
