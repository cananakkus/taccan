# Taccan: Instincts, Wild Ideas, and the Path to Something Unforgettable

Date: 2026-02-23
Perspective: A deep reading of every source file, every planning doc, every CSS rule, and every socket event. These are not incremental tickets. These are instincts about where the soul of this project lives and where it could go.

---

## Part 1: What Taccan Already Is (and Doesn't Know It Yet)

You've built something with real character. The paper-and-ink aesthetic isn't just a skin; it's an identity waiting to be fully inhabited. The "Guild Cipher Desk" framing, the SVG ink stamps on revealed cards, the parchment grain texture, the Cinzel and Cormorant Garamond type pairing -- this isn't a generic Codenames clone. This is a game that wants to be a *place*. A wartime intelligence bureau. A candlelit back room where spymasters slide dossiers across oak tables.

Most of the existing roadmap (and it's an excellent roadmap) focuses on mechanics, scale, and retention. What's missing is the recognition that Taccan's greatest competitive advantage is not its feature set -- it's its atmosphere. Every suggestion below flows from that instinct.

---

## Part 2: The Unbuilt Senses

### 2.1 Sound is the Missing Dimension

The entire experience is silent. This is the single highest-impact change available. Not background music -- *diegetic sound design*.

Ideas:
- **Paper sounds.** Card reveals should sound like a page turning. Card marking should sound like a pencil scratch. The countdown should tick like a pocket watch, not beep like a microwave.
- **Ink stamp.** When a card is revealed, the SVG stamp that appears should be accompanied by a soft rubber-stamp *thunk*. Different timbres for red/blue/neutral/assassin.
- **Room ambience.** A faint, loopable ambience: distant rain, creaking wood, a pen nib scratching. Togglable. This alone would make people say "wait, this is *nice*."
- **Assassin revelation.** A sharp, dissonant chord. A record scratch. Something that makes the room inhale. The assassin hit is the most dramatic moment in the game and right now it's identical to any other card flip.
- **Countdown heartbeat.** During the last 5 seconds of any timer, a heartbeat pulse. Low, subtle, physical.

Implementation: Use the Web Audio API. Load a small sprite sheet of samples (< 200KB total). Expose a `SoundEngine` singleton in app.js that reacts to state transitions. Add a mute toggle. No library needed.

### 2.2 Haptics on Mobile

For mobile devices, use the `navigator.vibrate()` API:
- Short pulse on card selection.
- Double pulse on correct guess.
- Long buzz on assassin hit.
- Heartbeat pattern during last 5 seconds of timer.

Zero dependency, three lines of code per event, and it transforms the tactile feel of mobile play.

### 2.3 The Envelope Animation

Right now, card reveal uses a `reveal-pop` scale animation. Consider: the card could *open* like a wax-sealed envelope. The unrevealed card is the envelope face. On reveal, a CSS perspective transform flips it open, the stamp appears from inside, and the color bleeds through like ink soaking into paper. This is achievable with pure CSS `transform: rotateY()` and `backface-visibility`. It would be the single most memorable micro-interaction in the game.

---

## Part 3: The Spymaster's Burden

### 3.1 The Loneliest Role

Spymaster is the hardest role in Codenames, and the current UI doesn't acknowledge this. The spymaster sees the keycard colors on the board, fills in a word and number, and presses Transmit. But psychologically, the spymaster is *agonizing*. They're looking at the board, mentally grouping words, weighing risks, afraid of the assassin.

Suggestions:

- **Spymaster scratch pad.** A small, private, ephemeral text area below the board visible only to the spymaster. For jotting groupings, rejected hints, danger notes. Never sent to the server. Just `localStorage` or in-memory. It says: "we know this is hard. Here's a notepad."
- **Danger word highlighting.** The spymaster sees red/blue/neutral/assassin colors on the board. Let them *mark* their own danger words privately (a small skull icon on cards they're worried about). This is purely client-side visual annotation. It reduces cognitive load without changing game mechanics.
- **Hint history per game.** Show all hints given so far in a small sidebar. Currently history exists in `game.history` on the server but isn't rendered in the UI. Surfacing it helps the spymaster (and operatives) track the thread of deduction.

### 3.2 The Operative's Deliberation

Operatives talk to each other in real life. In the digital version, that coordination is missing. Before adding full team chat (a large feature), consider:

- **Operative confidence markers.** When an operative marks a card, show a small confidence indicator next to their name chip. "I think this is it" vs "maybe?" Just two states: firm mark (filled chip) vs tentative mark (outlined chip). Toggle between them with a second click.
- **Thinking indicator.** When any operative on the active team has a card selected (but not yet submitted), show a subtle "..." animation next to their name in the team roster. This is trivial to implement -- the mark data is already broadcast. It lets the team see who's thinking about what.

---

## Part 4: The Paper Universe

### 4.1 The Dossier Endgame

When a game ends, the board is frozen and the result text appears. This is functional but doesn't honor the story that just happened. Consider:

- **The Debrief.** At game end, instead of (or in addition to) the static result text, show a "dossier" -- a scrollable mini-document that reconstructs the game as a narrative. "Turn 1: Red Spymaster transmitted OCEAN (3). Operatives identified WHALE, SHIP, and ANCHOR. All correct. Turn 2: Blue Spymaster transmitted..." Generated from `game.history`, which already has all the data. Formatted like a typed intelligence report on parchment. This is the kind of thing players screenshot and share.
- **The Key Reveal.** After the game ends, show the full keycard as an overlay. Every Codenames player wants to see "what was the assassin?" and "which ones did we miss?" Right now, the keycard colors are visible only to the spymaster during the game and aren't surfaced post-game. The data is there (`card.color` is in the board state); it just needs to be shown when `phase === 'finished'`.

### 4.2 Seals and Signatures

The current stamp SVGs (bird for red, owl for blue, shattered shape for assassin) are great. Extend this visual language:

- Give each room a randomly generated "seal" -- a simple SVG emblem constructed from combinatorial parts (shield shape + inner icon + border pattern). Display it in the room header. It becomes the room's coat of arms for that session.
- When a player joins a room, show a brief "wax seal breaking" animation. This is purely decorative but it says *you are entering a secured space.*

### 4.3 Wear and Tear

The paper aesthetic could show *age* as the game progresses:
- As more cards are revealed, very subtly darken the board background. The paper is getting worn from use.
- In Blitz mode, add a barely-perceptible coffee ring stain that fades in after 3+ rounds. The desk has been lived at.
- CSS-only implementation: use `:root` custom properties updated by JavaScript based on `game.turnNumber` or elapsed time.

---

## Part 5: Modes That Change the Shape of Thinking

The existing roadmap covers Blitz, Match Series, and Themed Packs. Here are modes that create genuinely different cognitive experiences:

### 5.1 Cipher Mode

The spymaster's hint must be an anagram of a word on the board. The operatives must both solve the anagram *and* figure out which other words the hint connects to. This turns every hint into a puzzle wrapped in a puzzle. Server validation: check that the submitted hint, when sorted alphabetically by character, matches at least one board word (also sorted). The anagram itself is the hint, but the *number* still indicates how many other words to guess.

### 5.2 Blackout Mode

The board starts fully visible. After 10 seconds, all words are hidden (replaced with "???"). Players must guess from memory + the spymaster's hint. The spymaster still sees words. This is a memory game fused with deduction. Implementation: a `blackoutAt` timestamp in game state. After it passes, the client renders words as obscured. Spymaster view unaffected (they see colors anyway). Reconnecting players also get the blacked-out view.

### 5.3 Traitor Mode (4+ players)

One operative on each team is secretly a double agent. They can see the keycard. Their goal is to subtly steer their team toward neutral or opponent cards without being caught. At end of game, the team votes on who they think the traitor was. The traitor gets bonus points if undetected. This requires:
- A new role: `double_agent` (appears as `operative` to others).
- Server sends keycard to double agents as well as spymasters.
- Post-game vote phase.
- This is the most complex mode but also the most viral -- it creates stories people retell.

### 5.4 Duet Mode (2 players, cooperative)

Official Codenames: Duet adaptation. Two players, each sees a *different* keycard overlaid on the same board. They take turns giving hints to each other. Both are simultaneously spymaster and operative. Requires:
- Two keycards generated from the same board.
- Role duality: hint on your turn, guess on their turn.
- Shared assassins but different team cards.
- Turn limit (e.g., 9 total turns to find all agents).

This mode doubles the addressable audience. Couples, pairs, two friends. The current room system already supports 2-player rooms. The game engine needs a second keycard and alternating hint/guess between two "teams" of one.

### 5.5 Marathon Mode

A single-board game where both teams play *simultaneously*. No turns. Each team has a private spymaster channel. Operatives race to click their team's cards as fast as possible. First team to find all their cards wins. The board is shared; the chaos is real. This requires:
- Removing turn gates in the engine.
- Each team independently submits hints and guesses in parallel.
- Real-time race dynamics.
- Server resolves guesses immediately regardless of whose "turn" it is.

---

## Part 6: The Word Engine

### 6.1 Words Are Content, Not Data

The `words.js` file has 1000+ English words. This is functional but undifferentiated. Every Codenames clone uses "random English words." The word selection is secretly the most important content decision in the game because it determines how interesting hints can be.

Suggestions:

- **Curated word tension packs.** Not just "Sci-Fi" or "History" themes -- packs designed for *hint quality*. A "Dual Meaning" pack where every word has multiple interpretations (bank, crane, pitch, scale -- many are already in words.js). A "Concrete Nouns Only" pack for beginners. An "Abstract Concepts" pack for advanced play (justice, memory, silence, gravity).
- **Word difficulty rating.** Assign each word a 1-3 difficulty score based on ambiguity, abstractness, and cultural specificity. Board generation can then target a difficulty mix. Easy boards: mostly concrete, unambiguous nouns. Hard boards: abstract, polysemous words.
- **Word relationship seeding.** When generating a board, bias toward including 2-3 pairs of semantically related words (e.g., "ocean" and "whale", "castle" and "knight"). This creates natural hint targets and makes games more interesting. Use a small static co-occurrence map (hand-curated, ~200 pairs) and ensure each board has at least one pair per team.

### 6.2 Turkish Word Quality

The Turkish translations in `translations.js` cover ~240 words. This is good coverage, but some translations are simplified (e.g., `switch -> anahtar` which also means `key`). For Turkish play:
- Review and expand the Turkish dictionary to 500+ words.
- Add a Turkish-native word pack (words that are *interesting in Turkish*, not just translations of English words).
- The i18n system is already built to support this. The word translation architecture is clean.

### 6.3 Dynamic Word Packs via URL

Allow hosts to paste a URL to a JSON word pack (hosted anywhere). The server fetches it, validates format (array of 50+ strings), caches it, and uses it for that room. This turns word packs into user-generated content with zero backend work. The word pack format is already just an array -- no new schema needed.

---

## Part 7: The Social Layer

### 7.1 The Invite Experience

Currently, sharing happens by copying a 4-letter room code. This works but misses an opportunity for *anticipation*. Consider:

- **Shareable room link.** `https://taccan.app/room/ABCD` -- the server serves the same HTML (SPA), but `app.js` reads the code from the URL path and auto-fills it. This is a 10-line change to server.js (catch-all route serves index.html) and a 5-line change to app.js (parse `window.location.pathname`).
- **Share sheet integration.** On mobile, use the Web Share API (`navigator.share()`) to open the native share sheet with a pre-filled message: "Join my Taccan room: ABCD -- [link]". One button, native UX.
- **QR code for IRL play.** Generate a QR code for the room link (use a tiny inline SVG QR generator, no dependency). Display it in the room panel. Someone holds up their phone, others scan it. This bridges physical and digital beautifully.

### 7.2 Player Identity

Players currently have a display name and nothing else. They're ephemeral. This is fine for MVP but limits emotional investment. Without requiring accounts:

- **Persistent local identity.** Generate a random avatar (initials + color, or a small deterministic SVG face based on name hash) and store it in localStorage alongside the session. Display it in team rosters. Now players have faces, not just names.
- **Win/loss counter.** Store a simple `{ wins: N, losses: N, gamesPlayed: N }` in localStorage. Display it subtly on the join screen: "Agent record: 7W-3L." No server storage needed. It's a local trophy case.

### 7.3 The Postgame Handshake

After a game ends, before rematch, there's a dead moment. Fill it:

- **GG button.** A single "Good Game" reaction that all players can press. Shows a brief ink-splat animation on the board when pressed. Simple, universal, satisfying. One event, one animation, zero moderation risk.
- **MVP vote.** Each player votes for one other player as "best play." Winner gets a small crown icon next to their name in the rematch lobby. No persistence needed. It's just for the moment.

---

## Part 8: Technical Instincts

### 8.1 PWA and Offline Shell

Taccan is a single HTML file, one CSS file, three JS files. This is *perfectly sized* for a Progressive Web App.

- Add a `manifest.json` with the paper/ink color scheme.
- Add a service worker that caches the static shell (HTML, CSS, JS, fonts).
- The app loads instantly on repeat visits, even offline (showing "connecting..." until Socket.IO reconnects).
- Users can "Add to Home Screen" on mobile and get a full-screen, app-like experience.
- Implementation: ~50 lines of service worker code. No build tool needed.

### 8.2 The `board.innerHTML = ''` Problem

On every render cycle, `app.js` destroys and recreates all 25 card DOM nodes (`ui.board.innerHTML = ''` at line 1092). This works but:
- Kills ongoing CSS transitions.
- Resets focus state.
- Causes layout thrash.
- Prevents smooth card reveal animations.

Instead: create 25 card elements once (on game start or first render). On subsequent renders, *update* their attributes, classes, and text content in place. Track them in an array: `state.cardElements = []`. This is a targeted refactor (~60 lines changed) that enables all the animation ideas above and eliminates the "flash" that currently happens on each state update.

### 8.3 Optimistic Mark Toggle

Card marking currently does a full round-trip: click -> `emitWithAck('turn:mark_toggle')` -> server processes -> broadcasts `state:full` -> client re-renders. This creates a perceptible delay (100-300ms). Since marking is a non-authoritative visual cue (it doesn't affect game outcome), it can be optimistic:

- On click, immediately toggle the mark visually in the DOM.
- Fire the socket event in the background.
- If the server rejects it, revert on the next `state:full`.
- This makes marking feel instant.

### 8.4 Reduce Snapshot Size

The `state:full` payload includes the entire room, player list, game state, and board on every mutation. For a 6-player room with an active game, this is ~4-8KB per event. During a fast guess sequence, this fires rapidly.

Quick wins before implementing the full delta protocol from the RFC:
- Strip `marksByCard` Sets from the snapshot and instead send `marks` as a flat array of `{ index, names }` only for cards that *have* marks. Most cards have zero marks.
- Omit `history` from routine snapshots. Send it only on game finish or explicit request.
- These two changes alone could halve snapshot size during active gameplay.

### 8.5 Deterministic Board Seeds

Currently, board generation uses `Math.random()` for both word selection and color assignment. If a seeded PRNG is used instead (e.g., a simple mulberry32), the same seed produces the same board. This enables:

- **Replay verification.** Given a seed, anyone can regenerate the board and verify a game's turn log.
- **Weekly challenge.** Use `weekNumber + year` as the seed. Everyone gets the same board.
- **Rematch with same words.** Useful for "we want a redo with the same board."
- **Bug reproduction.** Seed in logs allows exact board recreation.

Implementation: Replace `Math.random()` calls in `shuffle()` and `sampleWords()` with a seeded RNG. Store the seed in `game.seed`. ~15 lines of code.

---

## Part 9: Accessibility as Design, Not Compliance

### 9.1 Colorblind Patterns

The existing roadmap mentions colorblind-safe indicators. A specific implementation: use CSS `background-image` patterns overlaid on the keycard colors. Red cards get diagonal stripes. Blue cards get dots. Neutral gets crosshatch. Assassin gets a solid dark fill. These patterns are visible alongside the color, not instead of it. Toggle them with a setting stored in localStorage.

### 9.2 Screen Reader Game Flow

The board is currently a grid of `<button>` elements, which is good. But they lack ARIA labels. Each card button should have:
- `aria-label="Card 7: CASTLE, unrevealed"` (or `"Card 7: CASTLE, revealed, blue team"`)
- The turn banner should be an `aria-live="polite"` region (some elements already have this).
- The hint display should announce automatically: "Red spymaster's hint: OCEAN, 3."
- Guess confirmation should announce: "You guessed WHALE. Correct, blue team's card."

### 9.3 Keyboard Game Flow

Tab through cards should follow a 5x5 grid pattern. Arrow keys should navigate the grid spatially (left/right/up/down). Enter or Space should select/guess. This makes the game fully playable without a mouse.

---

## Part 10: Ideas That Might Be Crazy

### 10.1 AI Spymaster

Use the Anthropic API (or any LLM API) to generate hints for a team. The AI sees the keycard and the board, and produces a hint word and count. This enables:
- Solo play against an AI team.
- Practice mode where the AI spymasters and you guess.
- "Hint coach" mode where the AI suggests a hint but the human spymaster can override.

The prompt would be: "You are playing Codenames. Your team's words are: [list]. Opponent's words are: [list]. Neutral words are: [list]. Assassin word is: [word]. Give a one-word hint and a number. Explain your reasoning." The API call happens server-side. The hint is submitted to the game engine like any other hint.

### 10.2 AI Hint Analysis (Postgame)

After a game finishes, offer an "Analyst Review" button. It sends the game history to an LLM and gets back a brief analysis: "Turn 3's hint COLD (2) was clever -- it connected ICE and SNOW, but FROST was a risk because it's also on the board as a neutral. The operatives correctly avoided it." This is a postgame-only, non-realtime feature. It turns every game into a learning experience.

### 10.3 Voice Hints

Instead of typing a hint, the spymaster can speak it. Use the Web Speech API (`SpeechRecognition`) to capture a single word. The transcript is sent as the hint. This creates a more natural, "spymaster briefing" feel, especially on mobile. The number is still typed. Fallback to text input if speech recognition is unavailable or fails.

### 10.4 Theatrical Mode

A presentation mode for streamers, parties, or projector setups:
- Full-screen board view with large text.
- Animated hint reveal (the word types itself out letter by letter, typewriter style).
- Dramatic card flip animations with camera shake on assassin.
- Audience-facing: no controls visible, just the board, scores, and current hint.
- Triggered by a `/theater` URL parameter or a room setting.

### 10.5 The Dead Drop

An asynchronous play mode. The spymaster submits a hint. Then everyone closes their browser. Operatives come back later (within 24 hours) and submit their guesses asynchronously. The game advances only when all guesses are in (or a timeout expires). This turns Taccan into a slow, thoughtful, pen-pal-style game that can be played across time zones. The room state already persists for 8 hours; extending this with a database makes it indefinite.

---

## Part 11: Frontend Architecture Instincts

### 11.1 Don't Add a Framework

The existing vanilla JS is clean, readable, and ships zero bytes of framework overhead. The total frontend payload is ~60KB (excluding Socket.IO client). This is a massive advantage. Do not add React, Vue, or Svelte. Instead:

- Split `app.js` into ES modules: `socket.js`, `state.js`, `render.js`, `actions.js`, `i18n.js`, `sound.js`.
- Use native `import`/`export` with `<script type="module">`.
- No bundler needed. Modern browsers support this natively.
- The split should follow the existing logical sections in app.js. The function groupings are already there; they just need to be in separate files.

### 11.2 A Tiny State Machine

The scene system (`SCENE_CLASSES`, `setSceneClass()`) is a state machine that doesn't know it's a state machine. Formalize it:

```
lobby -> countdown -> playing(hint|guess) -> finished -> lobby|countdown
```

Guard transitions. Use the machine to determine which render functions to call, which UI sections to show, and which events to listen for. This eliminates entire categories of bugs (e.g., "what happens if you click guess while in hint phase?").

### 11.3 CSS Custom Properties as State Bridge

Instead of toggling many individual classes, set CSS custom properties on `:root` from JavaScript:

```js
document.documentElement.style.setProperty('--phase', game.phase);
document.documentElement.style.setProperty('--team', game.currentTeam);
document.documentElement.style.setProperty('--is-my-turn', myTurn ? '1' : '0');
```

Then in CSS, use these for conditional styling. This reduces the class-toggling surface and makes the CSS more declarative.

---

## Part 12: The Name

"Taccan" is distinctive and memorable. It sounds Turkish. It sounds like "tactic." It has the right number of syllables. It's easy to type and say. It doesn't conflict with existing brands.

The "Guild Cipher Desk" / "Taccan Codex" framing is evocative but could be sharper. Consider leaning harder into the intelligence bureau metaphor:

- The lobby is the **Briefing Room**.
- A game is a **Mission**.
- The board is the **Field**.
- The spymaster is the **Handler**.
- The operatives are **Field Agents**.
- The assassin card is the **Burned Asset**.
- A correct guess is a **Confirmed Contact**.
- The keycard is the **Cipher**.

This vocabulary could permeate the UI without changing any mechanics. It turns every tooltip, every status message, every toast notification into worldbuilding. The translations system already supports this -- it's just a matter of rewriting the string values.

---

## Part 13: What I Would Build Next (If It Were My Weekend)

In priority order, maximizing delight-per-hour-invested:

1. **Sound design.** 4-6 hours. Web Audio API, ~10 small samples, a mute toggle. Transforms the entire experience.
2. **Shareable room links.** 1 hour. Catch-all route + URL parsing. Removes friction from every invite.
3. **PWA manifest + service worker.** 2 hours. Instant repeat loads, home screen install.
4. **Stable card DOM (no innerHTML wipe).** 3 hours. Enables all future animation work.
5. **Postgame board reveal (show full keycard).** 1 hour. The data is already there.
6. **Spymaster scratch pad.** 1 hour. localStorage-backed text area. Zero server changes.
7. **Hint history sidebar.** 2 hours. Render `game.history` entries where `type === 'hint'`.
8. **GG button.** 2 hours. One socket event, one animation.
9. **Deterministic board seeds.** 2 hours. Seeded PRNG, store seed in game state.
10. **Envelope card flip animation.** 3 hours. CSS 3D transforms + the stable DOM from item 4.

Total: ~22 hours to make Taccan feel like a polished, released product rather than an MVP.

---

## Part 14: The Long Bet

Codenames has been played by millions of people. Every digital implementation is either a bare-bones free tool or a licensed product with limited innovation. There is no Codenames-*inspired* game that has built its own identity, its own audience, and its own metagame.

Taccan's paper-and-ink aesthetic, Turkish roots, and clean architecture position it to be that game. The bet is not on features but on *craft*. Sound, animation, wordplay, ceremony, and storytelling. The game is solved mechanically -- what remains unsolved is how to make people *feel* something when they play it.

Every suggestion in this document serves that feeling.
