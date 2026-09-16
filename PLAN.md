# 2v2 Consultation Chess — Plan

Realtime 2v2 chess. Two players per side, both commanding the same army,
alternating turns. Firebase RTDB, no backend.

## Decisions

### Game

**1. Consultation chess.** P1 and P2 both command the entire white army on
alternating turns; P3 and P4 do the same for black. One FEN, one king.
chess.js enforces every rule of chess. The custom layer on top is a turn gate
and nothing more.

**2. Per-team clock.** One time budget per side, shared by both teammates.
Tempo becomes a coordination problem — spending five minutes on your move
spends your partner's time too.

**3. Mutual consent to concede.** Resignation requires both teammates. A draw
requires both teammates to offer and both opponents to accept. A single
pending-offer node serves both cases.

**4. No in-app comms.** Four friends in a voice call cannot be silenced and
will not use a chat box as their primary channel. Building one buys nothing.

### Architecture

**5. Client-authoritative, RTDB security rules as the gate.** No Cloud
Functions, no Blaze plan, no cold starts. Rules enforce turn ownership and
`newData.turnIndex === data.turnIndex + 1`.

That increment assertion also eliminates the concurrent-write race for free:
two clients writing the same turn are mutually exclusive, because the loser's
write no longer satisfies the rule and is rejected. Clients need retry logic;
they do not need a correctness story.

**6. Append-only move log + cached FEN** is the sole source of truth. PGN, the
captured-piece tray, and the move list are pure functions of the log, derived
client-side. Every additional stored representation of the board would be
another surface to defend in rules.

**7. A single RTDB listener drives the board.** The SDK already applies local
writes to listeners immediately and re-fires them with the reverted value when
the server rejects. Optimistic UI and rollback are inherited, not built. No
second state machine, no reconciliation layer.

**8. Anonymous auth + per-slot secret.** The secret lives in a node clients
cannot read and is compared server-side inside rules. An anonymous UID alone
does not survive incognito, a cleared cache, or a different browser — the
secret does, so a player can always reclaim their seat.

**9. One room code, claim your seat.** Players enter a lobby and pick a slot
rather than being assigned P1–P4 by arrival order, which would otherwise let
network latency decide who is on whose team. Claiming a seat mints its secret;
rules reject claims against occupied seats.

**10. Disconnect → teammate takeover** after a ~20–30s grace period.
`onDisconnect` sets `connected: false`. The team clock never pauses, so
abandonment self-resolves by flag eventually; takeover keeps the present
teammate from watching shared time burn in the meantime. The absent player
reclaims their slot with their secret (#8).

### Process

**11. Rules unit tests against the emulator** (`@firebase/rules-unit-testing`),
asserting the attacks directly: moving out of turn, skipping or reusing a
`turnIndex`, claiming an occupied seat, claiming a seat with a wrong secret,
backdating `lastMoveAt`, reading the secrets node. Rules are the entire
security model, and playing the game is a bad way to discover they are wrong.

## Schema

```json
"games/$gameId": {
  "fen": "...",              // cache, for instant load
  "turnIndex": 0,
  "turnOrder": ["P1","P3","P2","P4"],
  "clocks": { "w": 600000, "b": 600000 },
  "lastMoveAt": 1234567890,  // rules validate against `now`
  "players": { "P1": { "uid": "...", "connected": true, "lastSeen": 0 } },
  "moves": { "$pushId": { "san","from","to","by","fenAfter","captured","ts" } },
  "offer": null,             // pending resign/draw consent
  "status": "active",
  "result": null
}
// games/$gameId/secrets/$slot — write-compare only, never client-readable
```

`turnOrder` is an array, which is what makes the 2-player and 4-player games
the same game: two players is `["P1","P3"]`, four is `["P1","P3","P2","P4"]`.
Same rotation code, same rules, different array length.

## Phases

1. **Local hot-seat chess.** chess.js + board UI, two players one keyboard. No
   Firebase at all. Proves the rules layer and the rendering before any
   network exists.
2. **Schema, rules, and rules tests — headless.** Emulator plus
   `@firebase/rules-unit-testing`. No UI. The attacks in #11 are the
   acceptance criteria.
3. **Listener-driven board over RTDB**, with `turnOrder` of length 2. Real
   two-player networked game. Single listener (#7), append-only log (#6).
4. **Lobby, seats, and secrets** — room code, seat claiming, secret minting,
   reclamation. `turnOrder` grows to length 4; per #12 below this is expected
   to be a small change rather than a new system.
5. **Clocks, grace period, consent.** Per-team clocks with rule-validated
   timestamps, disconnect grace and takeover, the shared resign/draw offer
   node.
6. **Polish.**

**12.** The Phase 3 / Phase 4 boundary may not be real. Because `turnOrder` is
just an array, going from two players to four is a length change, not an
architecture change. If that holds, the phases merge; if it doesn't, the
seam is exactly where the assumption broke and worth understanding.

## Residual risk, accepted

Security rules cannot run chess.js. They cannot verify that a claimed
`fenAfter` legally follows from the previous position, nor that a
`status: "checkmate"` is genuine. **Turn order is airtight; board legality is
enforced only by the client.**

This is the deliberate trade of decision #5 — correct for a game among
friends, not for a game among strangers. If the game is ever opened to
strangers, the Cloud Function comes back to validate moves server-side.
Nothing else in this design has to change.

## Cut from the earlier draft

Cloud Functions and the Blaze plan requirement; the old Phase 4; the stored
`pgn` field; the `captured` node; `teamChat` and its rules; FIFO slot
assignment; and "teammate visibility", which was never a feature — two clients
listening to one node is the default behavior.

---

# Implementation notes

Written after building it. Where the code departs from the plan above, this is
what changed and why. The decisions all survived; three of the mechanisms did
not.

## 1. `turnOrder` is a map, not an array

Decision #12 assumed `turnOrder: ["P1","P3","P2","P4"]`. Security rules cannot
index an array by a computed position — there is no way to turn `turnIndex %
length` into a child key inside a rule, because rules have no number-to-string
conversion. So the stored form is a successor map plus the current seat:

```json
"rotation": { "P1": "P3", "P3": "P2", "P2": "P4", "P4": "P1" },
"toMove": "P1"
```

A rule can then assert `newData.toMove === rotation.child(data.toMove)`, which
is the whole turn rotation in one expression. The array is derived on read by
walking the cycle, so the client model is unchanged.

The insight behind #12 survives intact, and got sharper: two seats is a 2-cycle,
four is a 4-cycle, same code. Better still, **a teammate is two hops around the
cycle** — which in a two-seat game lands back on the seat itself, so the
takeover rule (#10) degrades to "no takeover" with no special case anywhere.

`turnIndex` is still stored and still carries the `+ 1` assertion of #5. It is
the race guard; `toMove` is the key rules look things up by.

## 2. Secrets had to move out of the game node

The schema above put them at `games/$gameId/secrets/$slot`. **That does not
work.** An RTDB `.read` grant cascades to every descendant and no child rule can
revoke it, so a secrets node under a readable game node is readable by everyone
in the room, whatever rule sits on it. Decision #8 would have been silently void.

They live at the root instead, alongside a write-only proof node:

```
/secrets/$gid/$slot       write-once, only by whoever holds the seat; never readable
/proof/$gid/$uid/$slot    written by a returning player; never readable
```

Reclaiming is two writes: proof first, then the seat. Rules compare the two
values server-side without either being legible to anyone. `rules.test.ts`
keeps the trap documented — one test asserts that a read of
`games/$gid/secrets` *succeeds*, which is exactly the hazard.

Minting the secret happens **after** claiming the seat, and rules only allow it
from the seat's current holder. The other order would let a bystander mint a
secret for a seat they never sat in and lock the real player out forever.

## 3. Consent takes two writes, not one

Rules evaluate against the pre-write tree, so the last player to agree cannot
also end the game in the same update — their own acceptance is not visible to
the rule that checks whether everyone has agreed. Accepting writes only
`offer/accept/$slot`. A separate write settles it, attempted by every seated
client the moment the listener shows complete consent; the first one wins and
the rest fail harmlessly against a game that is no longer active. The flag call
works the same way, for the same reason.

Relatedly, `offer` has no `.write` of its own. Granting one would cascade onto
`offer/accept` and let an offerer forge their opponents' signatures in the same
update — consent enforced by a rule that the consenting write can bypass.

## 4. Smaller things

- `status` gained `lobby` and `timeout`. The lobby is a real state, not the
  absence of one, and the flag is an outcome rules *can* verify against `now`.
- Each move record carries `index`, binding the log entry to the turn counter it
  was played on. Rules check it, which is what stops a replayed entry.
- Clock decrements are validated within ±3s. A client cannot know the server's
  `now` exactly, so some tolerance is unavoidable; the cost is that a determined
  cheat can claw back about three seconds a move. Accepted, and it is the same
  trade as #5 rather than a new one.
- `database.rules.json` is generated by `rules/build.mjs`. Rules have no
  functions, so the alternative was the same predicate hand-copied into a dozen
  string literals — which, for a file that is the entire security model, is not
  a readability problem but a correctness one.

## 5. The Phase 3 / Phase 4 boundary was not real

As #12 suspected. A two-seat game and a four-seat game differ by the contents of
one map. The same rules, the same components and the same write functions serve
both, and the two-seat case is covered by the same tests. The phases merged.

## 6. Residual risks, on top of the one already accepted

- **Multiple moves in a single update.** Rules enforce append-only and bind each
  entry to `index`, but a client could append two entries in one update while
  incrementing `turnIndex` once. The position and turn stay correct; only the
  log gains a duplicate. A griefing teammate is outside the threat model.
- **The room code is the only barrier to reading a game.** Any signed-in user
  who knows a code can watch that game. Codes are five characters from a
  31-letter alphabet, which is fine for keeping strangers out of a game they
  have no reason to look for, and is not a secret.
