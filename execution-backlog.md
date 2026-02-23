# Taccan Execution Backlog

Date: 2026-02-18  
Goal: Convert creative review into an actionable delivery plan.

## Prioritization Model
Scoring axis:
1. `Impact` (player value + retention)
2. `Confidence` (clarity and implementation risk)
3. `Effort` (engineering/design/test complexity)

Priority heuristic: high impact, high confidence, low-to-medium effort first.

## NOW (0-2 weeks)

### 1. Ready Check + Start Countdown
- Why now: improves social ritual and eliminates ambiguous game starts.
- Scope:
1. Add `ready` state per player in lobby.
2. Host can start only when minimum ready threshold met (configurable default: all connected non-spectators).
3. 5-second visible countdown with cancel on role/team changes.
- Effort: `M` (3-5 days)
- Owners: backend + frontend
- Success metric:
1. Decrease lobby abandonment before first game.
2. Increase room->game-start conversion.

### 2. Rematch Flow
- Why now: most direct retention multiplier.
- Scope:
1. `Rematch (same teams)` and `Swap sides + rematch`.
2. Preserve room roster.
3. Reset board/turn state cleanly.
- Effort: `M` (3-4 days)
- Owners: backend + frontend
- Success metric:
1. Increase average rounds per room.
2. Increase sessions with >=2 completed rounds.

### 3. Mobile Focus Mode
- Why now: high practical usability gain.
- Scope:
1. Board-first mobile layout toggle.
2. Action rail pinned (`Submit Guess`, `End Turn`).
3. Team panes collapsed into tab/drawer.
- Effort: `M` (4-6 days)
- Owners: frontend + design
- Success metric:
1. Better completion rate from mobile clients.
2. Lower mobile drop-off during guess phase.

### 4. Accessibility Baseline
- Why now: prevents expensive retrofitting.
- Scope:
1. Keyboard navigation across core game loop.
2. ARIA labels for cards/controls.
3. Colorblind-safe markers (shape/pattern + color).
- Effort: `M` (3-5 days)
- Owners: frontend
- Success metric:
1. Pass core accessibility audit checks.
2. No keyboard dead-ends in gameplay.

### 5. Funnel and Turn Telemetry
- Why now: informs everything next.
- Scope:
1. Track funnel events (`landing`, `join/create`, `game_start`, `game_finish`, `rematch_start`).
2. Track phase durations (`hint_duration_ms`, `guess_duration_ms`).
3. Track room-level outcomes (`round_count`, `abandon_reason`).
- Effort: `S-M` (2-4 days)
- Owners: backend
- Success metric:
1. Dashboard operational with daily metrics.
2. Baseline retention/cohort report available.

## NEXT (2-6 weeks)

### 6. Blitz Mode
- Scope:
1. Per-turn hard timers.
2. Lobby mode preset.
3. Distinct UI cues and mode badge.
- Effort: `M` (4-6 days)
- Dependency: telemetry + timer primitives

### 7. Match Series (Best-of-N)
- Scope:
1. Best-of-3/5 selection.
2. Side swaps between rounds.
3. Match scoreboard.
- Effort: `M-L` (5-8 days)
- Dependency: rematch system

### 8. Themed Word Packs
- Scope:
1. Word pack registry.
2. Host-selected or random pack.
3. Admin tooling for pack validation.
- Effort: `M` (4-7 days)
- Dependency: persistence optional but recommended

### 9. Weekly Challenge
- Scope:
1. Seeded board configuration by week.
2. Shared challenge code.
3. Challenge leaderboard (optional in phase 1).
- Effort: `M` (4-6 days)
- Dependency: match result persistence

### 10. Replay Logging (Turn-Level)
- Scope:
1. Persist compact event timeline.
2. Internal replay serializer.
3. Debug replay export endpoint.
- Effort: `M` (4-7 days)
- Dependency: persistence

## LATER (6-12+ weeks)

### 11. Redis-backed Active Room Store + Socket Adapter
- Effort: `L` (2-3 weeks)

### 12. Postgres Match/Player Stats
- Effort: `L` (2-3 weeks)

### 13. Delta Sync Protocol + Sequence IDs
- Effort: `L` (2-4 weeks)

### 14. Ranked + MMR + Seasonal Ladder
- Effort: `L-XL`

### 15. Tournament Rooms + Spectator Overlay
- Effort: `L-XL`

## Cross-Cutting Technical Tasks
1. Feature flag framework for controlled rollouts.
2. Protocol versioning in socket handshake.
3. Admin observability endpoint and room diagnostics.
4. Load test script for concurrent room simulation.

## Suggested Team Cadence
1. Weekly planning: choose 2 NOW items max.
2. Mid-week checkpoint: telemetry + blocker review.
3. Friday release train: one feature flag-enabled ship batch.

## Definition of Success (90-day window)
1. `+30%` sessions with >=2 rounds played.
2. `+20%` room-to-game-start conversion.
3. Mobile completion parity approaching desktop.
4. Stable operations under multi-room load with clear scaling path.
