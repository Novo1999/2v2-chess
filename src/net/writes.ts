/**
 * Every write this app makes, as a plain multi-path update object.
 *
 * These are pure functions of the current node plus an intent — no Database
 * handle, no side effects. That is what lets the rules tests exercise the exact
 * update the app sends, instead of a hand-rolled approximation of it that can
 * drift away from the shipped code without anyone noticing.
 */

import { serverTimestamp } from 'firebase/database';
import type { GameStatus, MoveIntent, Result, Slot } from '../game/types';
import { SLOT_COLOR } from '../game/types';
import { applyMove, START_FEN } from '../game/rules';
import type { NetGame, Offer, OfferKind, PlayerPresence, SeatCount } from './schema';
import {
  armySeats,
  isSeatFilled,
  rotationFor,
  seatsOf,
  teammateIn,
  toGameState,
} from './schema';

/** Default time budget per army. Shared by both teammates (decision #2). */
export const DEFAULT_CLOCK_MS = 10 * 60 * 1000;

/** Mirrors GRACE_MS in rules/build.mjs — kept in step by a rules test. */
export const GRACE_MS = 25000;

/** Mirrors RESERVE_MS in rules/build.mjs — kept in step by a rules test. */
export const RESERVE_MS = 2000;

/**
 * The amounts one team may hand the other. Mirrors GIFT_STEPS in
 * rules/build.mjs — kept in step by a rules test.
 */
export const GIFT_STEPS = [15000, 30000, 60000, 120000, 300000] as const;

/** "15s", "30s", "1m", "2m", "5m" — the slider's notches. */
export function giftLabel(ms: number): string {
  return ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`;
}

export type Update = Record<string, unknown>;

/** The whole node, for the one write that creates a game. */
export function newGameNode(
  seats: SeatCount,
  clockMs: number = DEFAULT_CLOCK_MS,
): Update {
  return {
    fen: START_FEN,
    turnIndex: 0,
    toMove: 'P1',
    rotation: rotationFor(seats),
    seats,
    clocks: { w: clockMs, b: clockMs },
    initialClock: clockMs,
    status: 'lobby',
    createdAt: serverTimestamp(),
  };
}

/**
 * Taking a seat. The secret is minted separately and afterwards — rules only
 * allow it from whoever already holds the seat, so the order is load-bearing.
 */
export function claimSeatNode(uid: string, name?: string): Update {
  const node: Update = { uid, connected: true, lastSeen: serverTimestamp() };
  if (name) node['name'] = name;
  return node;
}

export function presenceUpdate(connected: boolean): Update {
  return { connected, lastSeen: serverTimestamp() };
}

/** Leaving the lobby. Sets the reference point the first clock tick measures from. */
export function startUpdate(): Update {
  return { status: 'active', lastMoveAt: serverTimestamp() };
}

export type MoveResult =
  | { ok: true; update: Update; status: GameStatus }
  | { ok: false; reason: string };

/**
 * The move write: new position, the incremented turn, the next seat, the
 * moving army's clock, and one appended log entry — one atomic update, so the
 * turnIndex assertion in rules covers all of it.
 */
export function moveUpdate(
  game: NetGame,
  intent: MoveIntent,
  moveKey: string,
  now: number,
): MoveResult {
  if (game.status !== 'active') return { ok: false, reason: 'game is not active' };

  const applied = applyMove(toGameState(game), intent, game.toMove, now);
  if (!applied.ok) return applied;

  const { move, state } = applied;
  const army = SLOT_COLOR[game.toMove];
  const nextSeat = game.rotation[game.toMove];
  if (!nextSeat) return { ok: false, reason: 'rotation is missing a successor' };

  const update: Update = {
    fen: state.fen,
    turnIndex: game.turnIndex + 1,
    toMove: nextSeat,
    lastMoveAt: serverTimestamp(),
    [`clocks/${army}`]: remainingAfterMove(game, now),
    status: state.status,
    [`moves/${moveKey}`]: {
      index: game.turnIndex,
      san: move.san,
      from: move.from,
      to: move.to,
      by: move.by,
      fenAfter: move.fenAfter,
      ...(move.captured ? { captured: move.captured } : {}),
      ts: serverTimestamp(),
    },
  };
  if (state.result) update['result'] = state.result;

  return { ok: true, update, status: state.status };
}

/**
 * What the moving army has left once this move lands. The clock never pauses
 * for a disconnect (decision #10), so this is plain wall-clock subtraction.
 */
export function remainingAfterMove(game: NetGame, now: number): number {
  const army = SLOT_COLOR[game.toMove];
  return Math.max(0, game.clocks[army] - (now - game.lastMoveAt));
}

/** Live clock reading for display: the side to move is the one draining. */
export function clockNow(game: NetGame, army: 'w' | 'b', now: number): number {
  if (game.status !== 'active') return game.clocks[army];
  if (SLOT_COLOR[game.toMove] !== army) return game.clocks[army];
  return Math.max(0, game.clocks[army] - (now - game.lastMoveAt));
}

export function hasFlagged(game: NetGame, now: number): boolean {
  return game.status === 'active' && clockNow(game, SLOT_COLOR[game.toMove], now) <= 0;
}

/** Calling the flag. Rules verify this one against `now` rather than trusting it. */
export function timeoutUpdate(game: NetGame): Update {
  const loser = SLOT_COLOR[game.toMove];
  return { status: 'timeout', result: loser === 'w' ? '0-1' : '1-0' };
}

// --- consent (decision #3) -------------------------------------------------

/**
 * Opening an offer. The offerer's own acceptance is written separately, under
 * `offer/accept/$slot`, because that is the only path rules let a seat's holder
 * write — bundling it here would mean writing `offer` wholesale, and a write
 * grant on `offer` cascades onto every teammate's `accept` child.
 */
export function offerFields(kind: OfferKind, by: Slot): Update {
  return {
    'offer/kind': kind,
    'offer/army': SLOT_COLOR[by],
    'offer/by': by,
    'offer/at': serverTimestamp(),
  };
}

export function clearOfferUpdate(seats: readonly Slot[]): Update {
  const update: Update = {
    'offer/kind': null,
    'offer/army': null,
    'offer/by': null,
    'offer/with': null,
    'offer/at': null,
  };
  for (const slot of seats) update[`offer/accept/${slot}`] = null;
  return update;
}

/**
 * Who still has to say yes.
 *
 * An empty seat is skipped rather than counted as a holdout — otherwise a team
 * playing a man down could never agree to anything, because one of the
 * signatures it needed would belong to a chair. This mirrors `agreedOrEmpty`
 * in the rules exactly.
 */
export function consentOutstanding(game: NetGame, offer: Offer): Slot[] {
  const required =
    offer.kind === 'swap'
      ? ([offer.by, offer.with].filter(Boolean) as Slot[])
      : offer.kind === 'resign'
        ? armySeats(game, offer.army)
        : seatsOf(game);
  return required.filter(
    (slot) => isSeatFilled(game, slot) && offer.accept?.[slot] !== true,
  );
}

export function consentComplete(game: NetGame, offer: Offer): boolean {
  return consentOutstanding(game, offer).length === 0;
}

/** The write that actually ends the game once everyone required has agreed. */
export function settleOfferUpdate(offer: Offer): Update {
  if (offer.kind === 'draw') {
    return { status: 'draw', result: '1/2-1/2' satisfies Result };
  }
  return {
    status: 'resigned',
    result: (offer.army === 'w' ? '0-1' : '1-0') satisfies Result,
  };
}

// --- trading seats ---------------------------------------------------------

/** Proposing a trade. Same node, same signatures, different question. */
export function swapOfferFields(by: Slot, withSlot: Slot): Update {
  return {
    'offer/kind': 'swap' satisfies OfferKind,
    'offer/army': SLOT_COLOR[by],
    'offer/by': by,
    'offer/with': withSlot,
    'offer/at': serverTimestamp(),
  };
}

/**
 * The settling write for an agreed swap: both seats in one update, so there is
 * never a moment where one player has stood up and the other has not sat down.
 *
 * Each player's own client re-mints the secret for the seat they land in — the
 * seat they moved into still carries the other player's secret, and only the
 * seat's current holder is allowed to replace it.
 */
export function swapSettleUpdate(game: NetGame, offer: Offer): Update | null {
  const there = offer.with;
  if (offer.kind !== 'swap' || !there) return null;

  const here = game.players?.[offer.by];
  const other = game.players?.[there];
  if (!here?.uid || !other?.uid) return null;

  return {
    [`players/${offer.by}`]: seatNodeFrom(other),
    [`players/${there}`]: seatNodeFrom(here),
  };
}

/** Carry a player's identity and presence into the seat they are moving to. */
function seatNodeFrom(player: PlayerPresence): Update {
  const node: Update = {
    uid: player.uid,
    connected: player.connected !== false,
    lastSeen: serverTimestamp(),
  };
  if (player.name) node['name'] = player.name;
  return node;
}

/** Seats this player could propose trading with: taken, and not their own. */
export function swappableSeats(game: NetGame, mySlot: Slot | null): Slot[] {
  if (!mySlot) return [];
  return seatsOf(game).filter(
    (slot) => slot !== mySlot && isSeatFilled(game, slot),
  );
}

// --- holding an empty seat while you take it -------------------------------

/** The hold itself. `at` is the server's clock, because rules check it. */
export function holdUpdate(uid: string): Update {
  return { uid, at: serverTimestamp() };
}

/**
 * Somebody else is mid-claim on this seat right now, so the button is greyed
 * out. Expiry is on read, not on a timer — a client that vanished mid-claim
 * releases the seat simply by the clock passing.
 */
export function heldByOther(
  game: NetGame,
  slot: Slot,
  uid: string,
  now: number,
): boolean {
  const hold = game.reserve?.[slot];
  if (!hold || hold.uid === uid) return false;
  return now - hold.at < RESERVE_MS;
}

// --- handing the other team time -------------------------------------------

/**
 * The chess.com gesture: time to the opponents, never to yourself. That it can
 * only ever cost you the game is why it needs no limit — see the note on
 * `giftTo` in rules/build.mjs.
 */
export function giftUpdate(
  game: NetGame,
  to: 'w' | 'b',
  ms: number = GIFT_STEPS[0],
): Update {
  return { [`clocks/${to}`]: game.clocks[to] + ms };
}

/** The army a seated player is allowed to hand time to. */
export function giftTarget(game: NetGame, uid: string): 'w' | 'b' | null {
  if (game.status !== 'active') return null;
  const slot = seatOfUid(game, uid);
  return slot ? (SLOT_COLOR[slot] === 'w' ? 'b' : 'w') : null;
}

// --- who may act -----------------------------------------------------------

/**
 * The client-side mirror of the rules' move gate. The server decides; this
 * exists so the board can be disabled rather than letting a player make a move
 * that will be silently reverted a moment later.
 */
export function mayMoveNow(game: NetGame, uid: string, now: number): boolean {
  if (game.status !== 'active') return false;
  const onMove = game.toMove;
  if (game.players?.[onMove]?.uid === uid) return true;

  const mate = teammateIn(game.rotation, onMove);
  if (!mate || game.players?.[mate]?.uid !== uid) return false;
  // An empty seat carries no grace period. The wait exists to let a player who
  // dropped come back to their own turn; nobody is coming back to a seat that
  // was never taken, and waiting would burn 25s of shared clock every turn.
  return !isSeatFilled(game, onMove) || isAbsent(game, onMove, now);
}

export function isAbsent(game: NetGame, slot: Slot, now: number): boolean {
  const player = game.players?.[slot];
  if (!player) return false;
  return player.connected === false && now - player.lastSeen > GRACE_MS;
}

/** Seconds until a teammate may take over, or null if takeover is not pending. */
export function takeoverIn(game: NetGame, slot: Slot, now: number): number | null {
  const player = game.players?.[slot];
  if (!player || player.connected !== false) return null;
  const left = GRACE_MS - (now - player.lastSeen);
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

export function seatOfUid(game: NetGame, uid: string): Slot | null {
  return seatsOf(game).find((slot) => game.players?.[slot]?.uid === uid) ?? null;
}
