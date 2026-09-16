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
"Create a room" button turns blue once the URL is set.

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

## Layout

```
src/game/      chess.js + the turn gate. No network, no React.
src/net/       schema, writes as plain update objects, listeners, seats.
src/components/board, move list, clocks, lobby, trays.
rules/build.mjs      generates database.rules.json  <- edit this, not the JSON
rules/*.test.ts      emulator suites
```

`database.rules.json` is generated. RTDB rules have no functions, so the
predicates are composed in `rules/build.mjs` and emitted; editing the JSON by
hand will be overwritten by the next `npm run rules:build`.

## Known limits

Security rules cannot run chess.js, so they cannot check that a claimed position
legally follows from the previous one, or that a `checkmate` is real. Turn order,
clocks, seats and consent are enforced; **board legality is enforced only by the
client.** That is the deliberate trade in PLAN.md decision #5 — correct for a
game among friends, not for a game among strangers.

## Artwork

| In the app | Source | License |
|---|---|---|
| Classic pieces | [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett), Wikimedia Commons | BSD |
| Neo pieces | [Chessnut](https://github.com/LexLuengas/chessnut-pieces) by Alexis Luengas | Apache 2.0 |
| Wood pieces | generated from the Classic set by `scripts/build-wood-pieces.mjs` | BSD |
| Dark wood and Walnut grain | generated by `scripts/build-board-grain.mjs` | this project |

Each piece folder under `src/assets/pieces/` carries its own credit file. The
generated artwork is committed; re-run `npm run pieces:wood` or
`npm run board:grain` after changing either script.
