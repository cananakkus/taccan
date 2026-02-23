# Feature Spec: Top 3 Mechanics

Date: 2026-02-18  
Target release window: next 2-6 weeks

---

## Feature 1: Ready Check + Start Countdown

### Objective
Create a cleaner pre-game ritual and prevent accidental starts.

### User Stories
1. As a host, I want to see who is ready before I start.
2. As a player, I want clear feedback that game start is imminent.
3. As a room, we want a short countdown to settle final role/team decisions.

### Functional Rules
1. Each player has `ready: boolean` in lobby state.
2. Default ready rule: all connected players with `team != none` must be ready.
3. Host can trigger `game:start` only when rule passes.
4. On successful start request, room enters `countdown` state for 5 seconds.
5. Any team/role change during countdown cancels countdown.
6. Host can cancel countdown manually.
7. If room drops below readiness threshold during countdown, cancel automatically.

### Backend Changes
1. Room model:
- Add `countdown` object:
  - `active`, `endsAt`, `startedBy`, `startedAt`
2. Player model:
- Add `ready` flag (default false).
3. New events:
- Client->Server:
  - `ready:set { ready: boolean }`
  - `game:countdown_cancel {}`
- Server->Client:
  - `game:countdown_started { endsAt, durationMs }`
  - `game:countdown_cancelled { reason }`
  - `game:countdown_tick { msRemaining }` (optional, can be client-derived)
4. Validation:
- `ready:set` allowed only in lobby/finished state (not in active round).

### Frontend Changes
1. Add ready toggle button near role/team controls.
2. Add roster ready indicators.
3. Add full-width countdown banner with cancel affordance for host.
4. Disable `Start Game` button until readiness is met.

### Telemetry
1. `ready_toggle`
2. `countdown_started`
3. `countdown_cancelled`
4. `countdown_completed`

### Acceptance Criteria
1. Host cannot start if readiness rule fails.
2. Countdown appears to all clients in sync.
3. Team/role mutation cancels countdown.
4. Countdown completion starts game exactly once.

---

## Feature 2: Rematch + Side Swap

### Objective
Increase repeat rounds per room with minimal friction.

### User Stories
1. As players, we want one-click rematch after a game.
2. As teams, we want an option to swap sides for fairness.
3. As host, I want control over rematch type.

### Functional Rules
1. Available only when `game.phase === finished`.
2. Rematch options:
- `same_teams`
- `swap_teams`
3. Rematch preserves:
- room code
- connected players
- host
4. Rematch resets:
- board
- guesses/hints/turn state
- marks
5. Rematch readiness:
- optional: requires same ready-check process from Feature 1.

### Backend Changes
1. New event:
- Client->Server: `game:rematch { mode: "same_teams" | "swap_teams" }`
2. Authorization:
- Host-only by default (configurable in future).
3. Team mutation logic:
- For `swap_teams`, invert `red <-> blue`; `none` unchanged.
4. History:
- Add `matchId` and increment `roundNumber`.

### Frontend Changes
1. End-game panel with two buttons:
- `Rematch`
- `Swap Sides + Rematch`
2. Rematch context message in turn banner.
3. Optional mini-scoreboard for series tracking.

### Telemetry
1. `game_finished`
2. `rematch_requested`
3. `rematch_started`
4. `rematch_declined` (if vote/consent added later)

### Acceptance Criteria
1. Rematch starts without rejoin/recreate.
2. Side swap correctly updates all non-spectator players.
3. No stale marks/hints leak into rematch state.

---

## Feature 3: Blitz Mode

### Objective
Add high-intensity pacing mode for replayability.

### User Stories
1. As a host, I want a quick mode that feels competitive and urgent.
2. As players, we want clear timer-driven urgency.
3. As spectators, we want a faster, more dramatic match flow.

### Mode Config
Preset `Blitz` defaults:
1. Hint timer: 25s
2. Guess timer: 35s
3. Max hint count: 5
4. Auto end turn on guess timer expiry
5. Auto skip hint (with penalty) on hint timer expiry

### Functional Rules
1. Room has `mode: casual | blitz`.
2. Timers begin when phase starts.
3. On timeout:
- Hint phase: turn ends (or auto 0 hint, configurable)
- Guess phase: immediate `turn:end`
4. Timeout decisions must be server-authoritative.
5. Timer state included in snapshots for reconnect consistency.

### Backend Changes
1. Room/game config:
- Add mode + per-phase timer config.
2. Timer engine:
- Add server scheduler for active phase timeout.
3. Events:
- Server->Client:
  - `turn:timer_started { phase, endsAt }`
  - `turn:timer_warning { msRemaining }`
  - `turn:timer_expired { phase, outcome }`
4. Rule checks:
- Enforce hint count max based on mode config.

### Frontend Changes
1. Room mode selector in lobby.
2. Prominent phase timer near turn banner.
3. Warning states at 10s and 5s.
4. Mode badge visible throughout game.

### Telemetry
1. `mode_selected`
2. `timer_expired_hint`
3. `timer_expired_guess`
4. `blitz_round_duration_ms`

### Acceptance Criteria
1. Timers are synchronized and reconnect-safe.
2. Timeout outcomes are deterministic and consistent across clients.
3. Blitz and casual behaviors remain isolated by mode config.

---

## Shared Delivery Notes
1. Introduce feature flags:
- `feature_ready_check`
- `feature_rematch`
- `feature_blitz_mode`
2. Keep protocol backward compatibility with versioned handshake.
3. Add integration tests for each feature’s permission + timeout edges.
