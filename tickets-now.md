# Taccan NOW Tickets (Implementation-Ready)

Date: 2026-02-18  
Window: next 2 weeks  
Scope: execute highest-impact items already planned

## Ticket NOW-1: Ready Check + Start Countdown

### Goal
Require ready state before game start and provide a cancellable 5-second countdown.

### Status
Implemented in current branch.

### Files touched
1. `backend/server.js`
2. `backend/payload-schema.js`
3. `backend/room-utils.js`
4. `frontend/index.html`
5. `frontend/app.js`
6. `frontend/style.css`
7. `test/payload-schema.test.js`
8. `test/room-utils.test.js`

### Acceptance checklist
1. Host can only start when readiness conditions pass.
2. `game:start` triggers countdown, not immediate start.
3. Host can cancel countdown.
4. Team/role changes during countdown cancel countdown.
5. Readiness invalidation (disconnect/leave/unready) cancels countdown.
6. Snapshot includes ready and countdown state.
7. Tests pass.

### Follow-up tasks
1. Add integration socket tests for countdown race conditions.
2. Add telemetry dashboard panel for readiness funnel.

## Ticket NOW-2: Rematch (same teams / swap sides)

### Goal
Create low-friction replay loop after game finishes.

### Status
Implemented in current branch.

### Scope
1. `game:rematch` backend event.
2. End-screen rematch controls.
3. Team swap mode.
4. Round-series metadata (`matchId`, `roundNumber`).

### Proposed files
1. `backend/server.js`
2. `backend/game-engine.js`
3. `frontend/index.html`
4. `frontend/app.js`
5. `test/game-engine.test.js`
6. New integration test file (socket lifecycle)

### Acceptance checklist
1. Rematch does not require room recreation.
2. Swap correctly inverts red/blue players only.
3. Board/hint/mark state fully reset.

## Ticket NOW-3: Mobile Focus Mode

### Goal
Improve playability on small screens by making board actions primary.

### Scope
1. Toggle `Board`/`Roster` views on mobile.
2. Sticky bottom action rail.
3. Collapse side panels behind drawers/tabs.

### Proposed files
1. `frontend/index.html`
2. `frontend/style.css`
3. `frontend/app.js`

### Acceptance checklist
1. Guess actions always reachable without scrolling.
2. Team roster remains accessible in <=1 tap.
3. No layout overlap at common mobile widths.

## Ticket NOW-4: Accessibility Baseline

### Goal
Ensure keyboard and colorblind-safe baseline accessibility.

### Scope
1. Keyboard card navigation and activation.
2. ARIA labels for key interactive controls.
3. Non-color encoding for card states.

### Proposed files
1. `frontend/index.html`
2. `frontend/app.js`
3. `frontend/style.css`

### Acceptance checklist
1. Full gameplay possible without pointer device.
2. Contrast and state cues do not rely on color alone.
3. Basic accessibility audit passes.

## Ticket NOW-5: Product Funnel Telemetry

### Goal
Capture room funnel and pacing metrics for product decisions.

### Scope
1. Structured telemetry events for join/start/finish/rematch.
2. Turn duration aggregation.
3. Basic metrics endpoint expansion.

### Proposed files
1. `backend/server.js`
2. Optional `backend/telemetry.js` extraction
3. `README.md` metrics documentation

### Acceptance checklist
1. Session funnel data is queryable.
2. Turn timing data exists per round.
3. Dashboard-ready metrics can be exported.

## Suggested execution order
1. NOW-1 (done)
2. NOW-2
3. NOW-5
4. NOW-3
5. NOW-4

## Definition of Done for NOW batch
1. All tickets merged behind stable behavior.
2. `npm test` green in CI.
3. No regression in join/start/core loop.
