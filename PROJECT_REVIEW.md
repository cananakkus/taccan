# Project review — 2026-09-07

The current web app is Vue 3 with Pinia and Vite (the README still describes an older vanilla JavaScript frontend). Flutter provides a separate mobile client. Both use an Express/Socket.IO backend with in-memory rooms, per-player state snapshots, deterministic board generation, server-owned Blitz timers, and WebRTC signaling. The Docker image builds the web bundle and serves it from Node. `deploy.sh` synchronizes the checkout to the remote host and rebuilds its Compose service.

## Fixed in this review

- Repeated web reconnects: reset the rejoin guard on disconnect so subsequent connections restore the saved session.
- Rejoining on an already-bound socket: preserve room membership instead of deleting and recreating the player, which could delete a one-player room and lose its active game.
- Hidden keycard leakage: hide the deterministic board seed from operatives and spectators during an active game. Spymasters and finished-game views retain it.
- Root and `/taccan/` routing: derive browser API/Socket.IO URLs from the deployment base path; normalize prefixed API requests and WebSocket upgrades before server routing. Existing unprefixed reverse-proxy requests continue to work.
- Restored Blitz games: restart a missing phase timer on rejoin, without resetting an existing deadline. A restored phase receives its full configured duration.
- Reconnect grace after shutdown: timestamp players who were connected when saved, while preserving the original timestamp for already-disconnected players.
- Word-pack downloads: support Node DNS callbacks that return multiple addresses, reject private addresses in those results, and stop responses larger than 1 MiB.
- Test discovery: restrict the Node runner to backend tests so it does not try to run Vitest TypeScript tests.

Regression tests cover room preservation, hidden seed visibility, both Socket.IO transports under the subpath, repeated reconnect eligibility, restored timers, and shutdown timestamps.

## Remaining concerns

- **Session authentication:** `room:rejoin` treats `sessionId` as its credential, but player IDs are also broadcast in room snapshots. Someone already in a room could use another player's ID to impersonate them. A separate private reconnect credential needs coordinated backend, web, and mobile protocol/storage changes, with an explicit migration policy for deployed clients and saved sessions. This review does not resolve that vulnerability.
- **Deployment persistence:** saved state lives in `.taccan-state.json` inside the app directory. The repository does not contain the remote Compose file, so persistence across container replacement cannot be verified. The Dockerfile alone provides no persistent volume.
- **Deployment scope:** `deploy.sh` uses `rsync --delete` and synchronizes the working tree, including pre-existing local edits. Review the deployment payload before running it.

The existing mobile modifications were preserved. No production deployment or live game mutations were performed.

## Validation

- `npm test`: 55 backend tests passed.
- `npm run test:unit`: 5 frontend tests passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Headless Chromium against the local production bundle: room creation, two consecutive transport disconnect/rejoin cycles, and page refresh passed at both `/` and `/taccan/`, with no page errors.
- `git diff --check`: passed.

Browser checks used an ephemeral local server. Mobile was not built or device-tested in this review. The checks do not establish the remote proxy or Compose configuration.

## Voice and gameplay follow-up — 2026-09-08

Fixed additional user-visible failures:

- Web voice peers both initiated offers. The newcomer now initiates and existing members answer, matching the mobile client.
- Web ICE candidates received before the remote description (or before the peer notification) were discarded. They are now queued and applied after the description. Mobile signaling is also serialized per peer and waits for peer creation to finish.
- Disconnects left voice marked active with dead connections and a live microphone. Both clients now release voice resources, reset the UI, and permit a fresh join. The mobile SocketService now forwards disconnect and room-leave events to the voice service.
- Failed or cancelled joins release microphone tracks and clear the joining state. Web mute disables processed outbound tracks too; a saved volume of zero is no longer replaced with 100 percent.
- Web audio context initialization happens within the join button gesture. Its sample rate matches RNNoise, failed TURN fetches time out, and leaving releases the audio context. Failed peer connections are removed and reported.
- Phone CSS hid the entire parent of hint, guess, and result controls. Those controls now remain in the scrollable layout. The phone chat tab is restored, and voice controls have a tap-accessible toggle.
- Both clients show the latest public clue for each team, including after turn changes and while the opposing spymaster prepares a clue. This uses existing public history; game rules and keycard visibility are unchanged.
- Native voice had empty ICE servers left from crash diagnosis. It now loads STUN/TURN configuration from the backend. Existing Android permission/crash-workaround edits were retained. iOS now declares microphone usage.
- Server voice joins are idempotent, and signaling is accepted only between current voice members.

Validation: 56 backend tests; 10 frontend unit tests; TypeScript check and production build; three Playwright scenarios covering non-silent audio received and played in both directions, mute, disconnect/rejoin, and clue visibility across turns at 390px and 1280px. The phone voice controls were exercised at 390px. Flutter analysis reported no issues, and two Flutter tests passed, including the new clue-summary test. Flutter 3.47.2 was installed under `/tmp` for validation; because its SDK constraints differ from the checked-in lockfile, Flutter checks ran in a temporary copy with four SDK-constrained dependency adjustments. No project dependency or lockfile upgrades were made. Physical Android/iOS devices and cross-network relay calls have not been tested.

**Production prerequisite:** a read-only request to the live voice-credentials endpoint returned HTTP 200 with STUN but no TURN relay. Set `TURN_HOST`, `TURN_USERNAME`, and `TURN_CREDENTIAL` on the deployed backend and supply a reachable TURN service. The code supports that configuration, but this review did not provision a relay or deploy changes. Without TURN, restrictive networks can still prevent voice connections.

Reference behavior checked against [MDN ICE candidate handling](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate), [MDN negotiation guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation), and the [flutter_webrtc platform setup](https://pub.dev/packages/flutter_webrtc).


## TURN deployment completed — 2026-09-08

The earlier production prerequisite is now resolved. turn.wleeaf.dev resolves directly to 46.225.102.80. Server inspection found an existing Coturn instance with shared-secret authentication and open UDP/TCP 3478 plus UDP relay ports 49152–49999. It was reused without restarting or reconfiguring other services.

Taccan now supports TURN_SHARED_SECRET, generates Coturn-compatible credentials valid for 24 hours, and returns them with Cache-Control: no-store. Static username/password configuration remains supported. The web client refreshes credentials when joining voice again. The signing secret stays on the host, in /opt/wleeaf/taccan-turn.env with mode 0600; the Taccan Compose service references that env file.

The reviewed web/backend fixes and TURN support were deployed after confirming zero rooms and players. Runtime source is synchronized at /opt/wleeaf/taccan; the staged release is /opt/wleeaf/taccan-releases/20260908-turn. The previous image is retained as wleeaf-taccan:rollback-20260908, and source/Compose backups are under /opt/wleeaf/backups/taccan-20260908-turn.

Validation before deployment: 59 backend tests, 10 frontend tests, TypeScript, production build, three browser scenarios, and a staged Docker runtime check. Validation after deployment: live credential endpoint returns temporary credentials with no caching; external data-channel tests passed through relay candidates on both sides over both UDP and TCP. Two browsers then joined a temporary room on the live app with iceTransportPolicy: relay and exchanged non-silent audio in both directions, with remote playback active. The test players explicitly left afterward. Coturn's original start time remained unchanged. Native mobile binaries were not rebuilt or distributed by this deployment.

## Relay provenance investigation — 2026-09-08

Read-only server inspection plus the local Git history establish a direct Taccan connection:

- Commit 4685051 (2026-02-25), “Deploy to games.sancak.dev/taccan and fix voice chat in lobby,” explicitly added Coturn configuration for NAT traversal. The historical web voice client used turn:46.225.102.80:3478 over UDP/TCP and the username taccan. Credential values were not printed in the investigation.
- The currently running Coturn container was created March 25 and belongs to the wleeaf Compose project in /opt/wleeaf/docker-compose.yml. This is the current container creation date, not proof of the first relay installation date.
- Commit 362c207 (2026-03-31) moved hardcoded browser TURN credentials to a backend endpoint requiring environment variables. The deployment had only HOST configured before the September fix, leaving that endpoint STUN-only despite a running relay.
- May 18 and July 1 Compose backups already contain the Coturn service with a taccan static account and shared-secret authentication enabled.
- den.wleeaf.dev routes to the Stoat/Revolt deployment. Its mounted Revolt.toml config specifies LiveKit; livekit.yml disables built-in TURN. No current Coturn reference was found in its configuration or container environment. Taccan is the only explicit TURN consumer found among the inspected running/stopped containers and infrastructure configurations.

Conclusion: the relay has a documented Taccan history, rather than merely an inferred relationship to chat. Keep it for reliable voice across networks where direct WebRTC cannot connect. Not every call needs it, but removing it would remove that fallback. No infrastructure was changed during this provenance investigation; historical provisioning commands and an exact first-install date were unavailable.


## Native app removal — 2026-09-08

At the user's request, the mobile directory was removed from the repository. Earlier mobile findings above are historical. The complete local mobile working tree, including uncommitted changes and generated files, was moved to a sibling backup directory before removal. The browser app and backend remain the supported project. Browser test artifacts are ignored, and deployment excludes environment files, saved room state, and local generated artifacts.

## Browser layout accessibility — 2026-09-08

Replaced the empty lobby board and Teams/Feed overlays with visible team selection, readiness guidance, Start Game, and chat. During games, the board has team counts and both latest clues above it, actions below it, and persistent team/chat panels beside it on desktop or below it on phones. The header keeps labeled room, invite, settings, and voice controls accessible while scrolling; mute no longer requires opening audio options. Settings and debrief retain separate panels with explicit close buttons. Both English and Turkish labels are supported.

Browser coverage checks direct lobby actions, chat delivery, settings dismissal, clue visibility across turns, phone scrolling, and voice mute without opening a menu. A 320px Turkish case checks long labels and horizontal overflow in addition to the 390px and 1280px game cases.
