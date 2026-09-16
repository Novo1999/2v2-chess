/**
 * The shape of a game in the Realtime Database, and the translation between it
 * and the local `GameState` the rules layer and UI already speak.
 *
 * Two deliberate differences from the local model, both forced by what security
 * rules can express:
 *
 * 1. The rotation is a map (`{P1: 'P3', P3: 'P2', ...}`) rather than an array.
 *    Rules cannot index an array by `turnIndex % length` — there is no way to
 *    turn a number into a child key inside a rule — but they can look up
 *    `rotation.child(toMove)`. The array is derived on read. PLAN.md #12 still
 *    holds exactly: two seats is a 2-cycle, four seats is a 4-cycle, same code.
 *
 * 2. `toMove` is stored, not computed, for the same reason. It is redundant
 *    with `turnIndex` only in the sense that a cache is redundant; rules need it
 *    as a key, and rules validate the successor on every write.
 *
 * `secrets` and `proof` are NOT under the game node. An RTDB read grant
 * cascades to every descendant, so a secrets child beneath a readable game
 * would have been world-readable no matter what rule sat on it.
 */

import type { GameState, GameStatus, Result, Slot } from '../game/types';
import { SLOT_COLOR } from '../game/types';

export type Rotation = Partial<Record<Slot, Slot>>;

export const ROTATION_2: Rotation = { P1: 'P3', P3: 'P1' };
export const ROTATION_4: Rotation = { P1: 'P3', P3: 'P2', P2: 'P4', P4: 'P1' };

export type SeatCount = 2 | 4;

export function rotationFor(seats: SeatCount): Rotation {
  return seats === 2 ? ROTATION_2 : ROTATION_4;
}

export interface PlayerPresence {
  uid: string;
  name?: string;
  connected: boolean;
  lastSeen: number;
}

export interface NetMove {
  index: number;
  san: string;
  from: string;
  to: string;
  by: Slot;
  fenAfter: string;
  captured?: string;
  ts: number;
}

export type OfferKind = 'resign' | 'draw';

export interface Offer {
  kind: OfferKind;
  army: 'w' | 'b';
  by: Slot;
  at: number;
  accept?: Partial<Record<Slot, boolean>>;
}

export interface NetGame {
  fen: string;
  turnIndex: number;
  toMove: Slot;
  rotation: Rotation;
  seats: SeatCount;
  clocks: { w: number; b: number };
  initialClock: number;
  lastMoveAt: number;
  status: GameStatus;
  result: Result | null;
  createdAt: number;
  players?: Partial<Record<Slot, PlayerPresence>>;
  moves?: Record<string, NetMove>;
  offer?: Offer | null;
}

/** Walk the rotation cycle to recover the seat order as an array. */
export function cycleFrom(rotation: Rotation, start: Slot = 'P1'): Slot[] {
  const order: Slot[] = [];
  let at: Slot | undefined = start;
  while (at && !order.includes(at)) {
    order.push(at);
    at = rotation[at];
  }
  return order;
}

/**
 * The seat sharing this one's army. Two hops around the cycle: in a four-seat
 * game that is the teammate, in a two-seat game it is the seat itself, which is
 * the correct answer to "who can cover for you" when nobody can.
 */
export function teammateIn(rotation: Rotation, slot: Slot): Slot | null {
  const hop = rotation[slot];
  const back = hop ? rotation[hop] : undefined;
  return back && back !== slot ? back : null;
}

export function seatsOf(game: NetGame): Slot[] {
  return cycleFrom(game.rotation);
}

export function movesInOrder(game: NetGame): NetMove[] {
  return Object.values(game.moves ?? {}).sort((a, b) => a.index - b.index);
}

/** Project the network node onto the local model the board already renders. */
export function toGameState(game: NetGame): GameState {
  return {
    fen: game.fen,
    turnIndex: game.turnIndex,
    turnOrder: cycleFrom(game.rotation),
    moves: movesInOrder(game).map((m) => ({
      san: m.san,
      from: m.from,
      to: m.to,
      by: m.by,
      fenAfter: m.fenAfter,
      captured: (m.captured as never) ?? null,
      ts: m.ts,
    })),
    status: game.status,
    result: game.result ?? null,
  };
}

/** Which army a seat commands, for clock and consent bookkeeping. */
export function armyOf(slot: Slot): 'w' | 'b' {
  return SLOT_COLOR[slot];
}

/** Seats on `army`, restricted to the ones this game actually uses. */
export function armySeats(game: NetGame, army: 'w' | 'b'): Slot[] {
  return seatsOf(game).filter((slot) => armyOf(slot) === army);
}

export function isSeatFilled(game: NetGame, slot: Slot): boolean {
  return Boolean(game.players?.[slot]?.uid);
}

export function allSeatsFilled(game: NetGame): boolean {
  return seatsOf(game).every((slot) => isSeatFilled(game, slot));
}
