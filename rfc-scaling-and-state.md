# RFC: Scaling, State Durability, and Realtime Protocol Evolution

Status: Draft  
Date: 2026-02-18  
Authors: Taccan engineering

## 1. Context
Current implementation is single-process, in-memory room state with Socket.IO full-state fanout. This is appropriate for MVP but limits:
1. horizontal scale
2. restart resilience
3. analytics and replay depth
4. protocol evolution safety

This RFC defines the path to:
1. multi-instance realtime operation
2. durable match data
3. protocol versioning
4. bandwidth-efficient sync

## 2. Goals
1. Preserve server-authoritative game logic semantics.
2. Support multiple backend instances behind a load balancer.
3. Prevent active room loss on single process restart.
4. Enable match history, telemetry, and replay tooling.
5. Keep client compatibility explicit and manageable.

## 3. Non-Goals (for this RFC phase)
1. Ranked/MMR matchmaking design.
2. Full chat/voice subsystem.
3. Anti-cheat hardening beyond baseline event validation.

## 4. Proposed Architecture

### 4.1 Data Plane Components
1. `API/Realtime Node` (multiple instances)
2. `Redis`:
- active room state
- distributed locks
- pub/sub adapter
3. `PostgreSQL`:
- durable match summaries
- replay event store
- player stats (phase 2)

### 4.2 Socket Fanout
1. Use Socket.IO Redis adapter for cross-instance room broadcasts.
2. Maintain room affinity best-effort; no hard sticky dependency for correctness.
3. Use instance-local caches for hot room reads with short TTL.

### 4.3 State Ownership
1. Active room state canonical in Redis.
2. Each mutation:
- acquire room lock
- validate action
- apply deterministic transition
- write updated room state
- emit events
3. Persist post-round snapshots asynchronously to Postgres.

## 5. Data Model Evolution

### 5.1 Redis Keys (proposed)
1. `room:{code}:state` -> serialized room state JSON
2. `room:{code}:lock` -> lock token
3. `room:{code}:meta` -> timestamps, status, participant counters
4. `room:index:active` -> set of active room codes

### 5.2 Postgres Tables (phase 1)
1. `matches`
- `id`, `room_code`, `started_at`, `ended_at`, `winner`, `reason`, `mode`
2. `match_rounds`
- `id`, `match_id`, `round_number`, `starting_team`, `duration_ms`
3. `round_events`
- `id`, `round_id`, `seq`, `event_type`, `payload_json`, `at`

### 5.3 Retention
1. Redis room TTL for stale rooms.
2. Postgres long-term for analytics/replay.
3. Optional archival strategy for old raw events.

## 6. Protocol Evolution

### 6.1 Handshake Versioning
Client sends:
1. `clientVersion`
2. `protocolVersion`

Server responds:
1. accepted protocol version
2. compatibility flags
3. feature flag payload

### 6.2 Event Envelope
Introduce common envelope:
1. `eventId`
2. `roomCode`
3. `gameId`
4. `seq` (room or game scoped)
5. `ts`
6. `type`
7. `payload`

### 6.3 Compatibility Strategy
1. N and N-1 supported simultaneously.
2. Breaking changes require protocol bump.
3. Runtime warnings for deprecated clients.

## 7. Sync Strategy: Snapshot + Delta Hybrid

### 7.1 Current Issue
Full-state broadcasts on every action become expensive as room count and event frequency increase.

### 7.2 Proposed
1. Keep full snapshot for:
- initial join
- reconnect
- desync recovery
2. Use delta events for regular mutations:
- card reveal
- mark toggle
- phase transition
- timer updates

### 7.3 Client Recovery
1. Client tracks `lastSeq`.
2. If seq gap detected:
- request `state:resync`
- receive full snapshot

## 8. Concurrency and Consistency

### 8.1 Locking
1. Per-room distributed lock with expiry.
2. Mutation handler must verify lock ownership before write.
3. Fail-safe retry policy for lock contention.

### 8.2 Idempotency
1. Client-generated action IDs optional for retries.
2. Server dedup cache per room for recent action IDs.

### 8.3 Ordering
1. Monotonic `seq` assigned by authoritative mutation path.
2. Broadcast includes `seq`.
3. Persisted events also store `seq`.

## 9. Security and Reliability
1. Sign room session tokens (short-lived).
2. Enforce event rate limits per socket/session/user.
3. Add abuse circuit breakers (temporary room lockouts if flood detected).
4. Graceful shutdown:
- stop accepting new connections
- flush pending room writes
- release locks

## 10. Observability
Required metrics:
1. active rooms
2. connected users
3. mutation latency p50/p95/p99
4. lock contention rate
5. snapshot vs delta bytes sent
6. reconnect resync frequency
7. event processing error rate

Required logs:
1. structured per action with room/session IDs
2. lock acquire/release failures
3. desync/resync occurrences

## 11. Migration Plan

### Phase 0: Prep
1. Refactor room mutation into service layer boundaries.
2. Add protocol envelope + seq in single-process mode.

### Phase 1: Redis Active State
1. Introduce Redis room store behind interface.
2. Keep same external behavior.
3. Run in shadow mode with dual writes (in-memory + Redis) for validation.

### Phase 2: Multi-instance Realtime
1. Enable Socket.IO Redis adapter.
2. Deploy >=2 instances in staging.
3. Load test cross-instance room behavior.

### Phase 3: Postgres Persistence
1. Persist match summaries and round events.
2. Build basic match history endpoint.

### Phase 4: Delta Sync
1. Add delta events and seq-based recovery.
2. Keep snapshots as fallback.

## 12. Rollback Strategy
1. Feature flags for:
- redis room store
- delta sync
- protocol envelope enforcement
2. Revert path:
- disable feature flag
- fall back to full snapshots + in-memory (single instance)
3. Maintain backward-compatible client behavior during rollback windows.

## 13. Risks and Mitigations
1. Risk: race conditions with distributed locks
- Mitigation: robust lock token checks + chaos tests
2. Risk: client desync under delta protocol
- Mitigation: strict seq checks + instant resync endpoint
3. Risk: migration data inconsistency
- Mitigation: dual-write validation and diff monitors

## 14. Open Questions
1. Should room state be single JSON blob or segmented hash structure in Redis?
2. What is acceptable replay retention duration?
3. Should rematch series be modeled as one match with many rounds or separate matches linked by series ID?
4. Is sticky session required for cost/perf even if not required for correctness?

## 15. Acceptance Criteria
1. System continues serving active rooms after single instance restart.
2. Multi-instance deployment passes correctness load tests.
3. Protocol version handshake works with explicit compatibility responses.
4. Delta sync lowers outbound payload volume without correctness regressions.
