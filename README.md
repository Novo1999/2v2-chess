# Chesspacito

Realtime 2v2 chess. Two players per side, both commanding the same army,
alternating turns. Firebase Realtime Database, no backend.

The design and the reasoning behind it are in [PLAN.md](PLAN.md). This file is
how to run it.

## Quick start — no Firebase account needed

Everything runs against the local Firebase emulators, including anonymous
sign-in. Two terminals:

```bash
npm install
npm run emulator      # database on :9000, auth on :9099
```

```bash
npm run dev:local     # vite, pointed at the emulators
```

Open the URL Vite prints in four browser tabs (or four windows — one per
player), create a room in the first, and paste the room code into the others.
Emulator data is thrown away when you stop it.

`npm run dev` instead of `dev:local` runs against a real project (below).

## Playing

- **Hot seat** needs nothing at all — no emulator, no config. Every seat on one
  device, the same rules layer with the transport removed.
- **Online**: one player creates a room and reads out the five-character code.
  Everyone joins, claims a seat, and the game starts once the table is full.
- Seats are **P1/P2 for White, P3/P4 for Black**, and the rotation is
  `P1 → P3 → P2 → P4`: you and your teammate alternate turns commanding one
  army, sharing one clock and one king.
- Your seat is remembered in `localStorage`. Refresh, close the tab, or come
  back in a different browser and you get your seat back — see decision #8.
- If somebody drops, their teammate can play their turn after ~25 seconds. The
  team clock never pauses.

### When you are not four

- **Three players is a real game.** Start with a seat empty and the rotation
  still lands on it — the remaining teammate plays that turn, with no waiting,
  because nobody is coming back to a seat nobody took. The Start button says
  **Start a man down** when that is what it will do. Each army needs at least
  one player; that is the only requirement.
- **A latecomer drops straight in.** An empty seat stays open for the whole
  game, and **Open seats** in the side panel puts whoever turns up into it
  mid-game. Only someone with no seat, though — once the clocks are running, a
  player already at the table cannot hop to another seat, because that would
  change who is on whose side mid-game. Moving seats stays available in the
  lobby.
- **Clicking an empty seat holds it for two seconds**, so two people reaching
  for the same one see it greyed out as *Being taken…* rather than both
  clicking and one of them losing. The hold expires on its own.
- **Swapping seats** with somebody who already has one needs both of you to
  agree, the same way a draw does, and is a lobby-only move — once the clocks
  start, a swap would hand a player the other side's position mid-game.
- **Give the other team time**, as on chess.com. **Give time** in the side
  panel opens a slider over five amounts — 15s, 30s, 1m, 2m, 5m — and hands the
  chosen one straight to your opponents. Always to them, never to yourself, as
  often as you like.
- **Online now** on the home screen lists everyone with the app open, so you can
  see who is about before reading a room code out. Players show under the name
  they typed; anyone who typed none gets a handle their browser mints once and
  keeps, so the list is legible rather than four rows of "Anonymous".
- Right-click while dragging a piece to cancel the move and put it back.
- Online players can select or drag a piece while waiting to queue one premove.
  Both squares turn blue. It plays automatically on your seat's next turn if
  still legal; otherwise it is cleared. A new premove replaces the old one.
  Right-click the board or use **Cancel premove** to cancel it. Browsing move
  history also clears the premove.

## Playing with friends over the internet

This needs a Firebase project. The free **Spark** plan is enough and asks for no
card — there are no Cloud Functions in this design (decision #5), which is
exactly why it stays free.

### 1. Create the project

At <https://console.firebase.google.com> → **Add project**. Give it a name,
turn Google Analytics off (nothing here uses it).

### 2. Turn on the two services

- **Build → Realtime Database → Create Database.** Pick a location and choose
  **locked mode** — the rules in this repo replace whatever you start with in
  step 5.
- **Build → Authentication → Get started → Sign-in method → Anonymous →
  Enable.** Sign-in fails without this, and the app will tell you so.

### 3. Register a web app and copy its config

**Project settings** (the gear) **→ General → Your apps → Web `</>`**. Register
the app; Firebase shows a `firebaseConfig` object.

Copy `.env.example` to `.env.local` and fill it in from that object:

```bash
cp .env.example .env.local
```

`VITE_FIREBASE_DATABASE_URL` is the one that switches online play on. If the
config object has no `databaseURL`, copy it from the Realtime Database page —
it looks like `https://<project>-default-rtdb.<region>.firebasedatabase.app`.

**Vite reads env files at startup**, so restart `npm run dev` afterwards. The
"Create a room" button stops being disabled once the URL is set.

### 4. Sign the CLI in to the same project

```bash
npx firebase login
npx firebase use --add     # pick the project, give it any alias
```

### 5. Deploy

```bash
npm run deploy             # builds, then deploys rules + the app
```

This publishes the app to `https://<project>.web.app`. That URL is what you send
your friends — they open it, you read out the room code, everyone takes a seat.

**The security rules are the entire security model** (decision #5). `npm run
deploy` sends them along with the app, and `npm run deploy:rules` sends them
alone. Re-run one of those after any change to `rules/build.mjs`.

Hosting elsewhere works too — `npm run build` and serve `dist/` from any static
host. Only the database has to be Firebase.

## Tests

```bash
npm test          # rules engine, derived views, board interaction (jsdom)
npm run test:rules # security rules + a full game, against the emulator
npm run test:all
```

`test:rules` starts and stops its own emulator, and needs a JDK (17 works with
the pinned `firebase-tools@13`; newer CLI versions require 21). If a previous
run left the emulator behind, `npm run emulator:stop` frees the ports — it also
runs automatically before `test:rules` and `emulator`.

The rules suite asserts the attacks rather than the happy path: moving out of
turn, reusing a `turnIndex`, editing or deleting a logged move, backdating a
timestamp, inflating a clock, claiming an occupied seat, reclaiming with the
wrong secret, reading the secrets node, and resigning without your teammate.

It also covers the seat and clock changes above: vacating somebody else's seat,
claiming a seat under another player's hold, post-dating a hold so it never
expires, settling a seat swap with one signature, smuggling an unrelated uid
into a seat under an agreed swap, swapping once the clocks are running, gifting
time to your own army, giving an amount that is not one of the five, and
bolting time onto your own clock while playing a move.

## Layout

```
src/game/      chess.js + the turn gate. No network, no React.
src/net/       schema, writes as plain update objects, listeners, seats.
src/components/board, move list, clocks, lobby, trays.
src/components/controls.tsx  the shared Base UI controls
src/names.ts         handles for players who never typed a name
src/net/presence.ts  who has the app open, app-wide
rules/build.mjs      generates database.rules.json  <- edit this, not the JSON
rules/*.test.ts      emulator suites
```

## Interface

The interactive controls — the time slider, the on/off switches, the board and
piece choosers, the popover, the tooltips — are [Base UI](https://base-ui.com)
primitives (`@base-ui/react`). They supply behaviour, keyboard handling and ARIA
wiring, and **no styling at all**: the library bundles no CSS and leaves the
entire appearance to the app.

So the styles for those parts in `src/index.css` are Base UI's own, taken from
the CSS Modules examples that ship inside the package at
`node_modules/@base-ui/react/docs/react/components/*.md`. One departure: those
demos switch palette on `prefers-color-scheme`, and this app is dark
unconditionally, so each rule takes the demo's dark branch and applies it
always. Verbatim, they would render white popups inside a dark app for anyone
whose OS is in light mode.

The interface is monochrome on purpose — no accent hue, emphasis by inversion,
square corners. **The board is the exception**: its themes are a feature the
player picks, and check, last move and mate keep their colour because it is
information rather than decoration.

`database.rules.json` is generated. RTDB rules have no functions, so the
predicates are composed in `rules/build.mjs` and emitted; editing the JSON by
hand will be overwritten by the next `npm run rules:build`.

## Known limits

Security rules cannot run chess.js, so they cannot check that a claimed position
legally follows from the previous one, or that a `checkmate` is real. Turn order,
clocks, seats and consent are enforced; **board legality is enforced only by the
client.** That is the deliberate trade in PLAN.md decision #5 — correct for a
game among friends, not for a game among strangers.

Two smaller ones came with the features above, both inside the same threat
model — a griefing teammate was never defended against (PLAN.md residual #6):

- Anybody seated can hand the opponents time, over and over. It can only ever
  cost their own side the game, so rules pin the amount per press to one of five
  values but do not cap the number of presses.
- Anybody signed in can hold an empty seat for two seconds at a time. Holding it
  shut means renewing that forever, and it never takes a seat off somebody who
  is already sitting in it.
- **The online list is public to every signed-in client**, which is what makes it
  a list at all. An entry carries a name and a timestamp and nothing else — no
  game, no seat, no history — and exists only while that browser is connected.
  Nobody can write anybody else's entry, and the timestamp is checked against
  `now`, so a client cannot post-date itself to look permanently online.
- Opening the app now signs you in anonymously straight away, rather than at the
  first room you create or join, because being listed needs an identity.

## Artwork

| In the app | Source | License |
|---|---|---|
| Classic pieces | [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett), Wikimedia Commons | BSD |
| Neo pieces | [Chessnut](https://github.com/LexLuengas/chessnut-pieces) by Alexis Luengas | Apache 2.0 |
| Wood pieces | generated from the Classic set by `scripts/build-wood-pieces.mjs` | BSD |
| Dark wood and Walnut grain | generated by `scripts/build-board-grain.mjs` | this project |
| Logo and favicon (`public/favicon.svg`) | knights drawn after the Classic set | BSD |

Each piece folder under `src/assets/pieces/` carries its own credit file. The
generated artwork is committed; re-run `npm run pieces:wood` or
`npm run board:grain` after changing either script.

## Openings

The move list names the opening — `C50 Italian Game` — from
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
(CC0), 3810 named lines.

`npm run openings` regenerates `src/game/openings.data.json` from that source.
It replays each line and stores the **position** it reaches rather than the
moves, so transpositions are recognised: `1.d4 d5 2.e4 e6` is named the French
just as `1.e4 e6 2.d4 d5` is. The table is 59KB gzipped and is fetched on
demand rather than bundled, so the name appears a moment after the board.

Sound works the same way: drop `move.mp3`, `capture.mp3` or `check.mp3` into
`public/sounds/` and they replace the synthesised knocks, with no code change.
Nothing is committed there, so the app ships with the synthesised set.
