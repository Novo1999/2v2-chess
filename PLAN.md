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
