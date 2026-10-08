# Play tournament integration

The optional `PARTY_SECRET` enables private tournament adapters; `PARTY_DATA_FILE` stores their SQLite database. The restored service runs at `/murmur/` with guest-friendly standalone rooms. Retired aliases are unavailable. Existing Coturn can supply relay credentials with `TURN_HOST` and `TURN_SHARED_SECRET`; no separate voice broker is required.

The hub reserves four to eight players, alternates balanced red/blue teams, assigns one spymaster on each team, and starts a standard casual board once everyone connects. It scores all non-forfeited members of the winning team. Seats, teams and roles stay reserved across reconnects; operatives never receive hidden keycard colors or the reconstructible seed. The hub owns rematches and seat removal. A team with fewer than two eligible players forfeits, and a departing spymaster is replaced when the team can continue. Own names/colors remain editable and follow the hub.

The hub may fill seats with bots (`bot: true`, `skill: easy|normal|hard`). The server plays them as spymasters and operatives using an offline word-association table. They are always connected, cannot be joined, survive restarts, and finish the round at once if every human forfeits. See the README's "Play party" section.

Tournament rooms, moves, credentials and immutable results persist in SQLite WAL. Standalone rooms retain their separate graceful-shutdown JSON persistence. The Docker runtime is non-root with data under `/data`; deploy with one instance.

`npm test`, `npm run typecheck` and `npm run test:unit` cover normal rooms and tournament Socket.IO flows, private credentials, frozen roles, hidden keycards, native team wins, forfeits and restarts. Play's extended browser test covers four actual sessions, identity continuity, refreshes, mobile/landscape and automatic tournament transitions.
