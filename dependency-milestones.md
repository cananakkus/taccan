# Dependency Graph and Milestones

Date: 2026-02-18

## 1. Feature Dependency Graph

Legend:
1. `->` hard dependency
2. `~>` soft dependency

Graph:
1. Ready Check + Countdown -> Rematch
2. Ready Check + Countdown ~> Blitz Mode
3. Rematch -> Match Series (Best-of-N)
4. Telemetry Funnel -> Prioritization of all future modes
5. Replay Logging -> Balancing and Weekly Challenge tuning
6. Redis Active State -> Multi-instance deployment
7. Redis Active State + Protocol Envelope -> Delta Sync
8. Postgres Match Persistence -> Weekly Challenge leaderboard
9. Postgres Match Persistence -> Ranked/MMR groundwork
10. Protocol Versioning -> Safe iterative client feature rollout

## 2. Technical Dependency Graph (Platform)

1. Service-layer extraction (`server.js` decomposition)
  -> Redis room store abstraction
  -> lock orchestration
2. Redis room store
  -> Socket.IO Redis adapter
  -> multi-instance correctness tests
3. Protocol envelope + seq IDs
  -> delta sync
  -> desync recovery logic
4. Postgres event persistence
  -> replay tooling
  -> stats/ranked systems

## 3. Milestone Plan

### Milestone M1 (Week 1-2): Match Start Quality
Scope:
1. Ready check + countdown (implemented)
2. Countdown analytics
3. Countdown edge-case integration tests

Exit criteria:
1. Host cannot bypass readiness.
2. Countdown cancellation paths are deterministic.
3. Zero known countdown race bugs.

### Milestone M2 (Week 3-4): Retention Loop
Scope:
1. Rematch (same teams + swap)
2. Basic series metadata
3. Post-match summary UX

Exit criteria:
1. >=1 click replay flow operational.
2. Round state fully resets without leaks.

### Milestone M3 (Week 5-6): Mobile + Accessibility
Scope:
1. Mobile focus mode
2. Keyboard navigation
3. Colorblind-safe indicators

Exit criteria:
1. Mobile gameplay actions always reachable.
2. Keyboard-only core loop functional.

### Milestone M4 (Week 7-9): Product Analytics + Replay Seed
Scope:
1. Funnel telemetry completed
2. Turn duration metrics
3. Event persistence skeleton

Exit criteria:
1. Baseline dashboard available.
2. Data supports balancing decisions.

### Milestone M5 (Week 10-14): Scale Foundation
Scope:
1. Redis active room store
2. Multi-instance socket adapter
3. Protocol envelope + seq

Exit criteria:
1. Multi-instance staging stable under load.
2. Reconnect consistency preserved.

### Milestone M6 (Week 15+): Differentiation Modes
Scope:
1. Blitz mode
2. Weekly challenge
3. Match series scoring

Exit criteria:
1. At least one new mode adopted by active rooms.
2. Mode telemetry supports next roadmap decisions.

## 4. Critical Path

1. M1 -> M2 -> M4 -> M5 is critical for growth + stability.
2. M3 can partially run in parallel with M2.
3. M6 should only start after M4 telemetry is stable.

## 5. Risk Gates per Milestone

1. Gate A (after M1): start flow regressions must be zero high-severity.
2. Gate B (after M2): replay flow bugs must be below agreed threshold.
3. Gate C (after M4): telemetry completeness >90% for core events.
4. Gate D (after M5): load test SLOs met before scale rollout.

## 6. Ownership Matrix (Suggested)
1. Backend lead: M1, M2 backend, M4, M5
2. Frontend lead: M1 UI, M2 UI, M3
3. Product/design: M2 loop quality, M3 UX, M6 mode design
4. QA: cross-milestone regression + scenario matrix
