/**
 * The turn gate, and nothing more.
 *
 * chess.js owns every rule of chess. This module owns exactly one question that
 * chess.js cannot answer: of the two players sharing this army, is it *this*
 * one's turn? Everything else here is delegation.
 */

import { Chess } from 'chess.js';
import type {
  GameState,
  MoveIntent,
  MoveRecord,
  PieceSymbol,
  Result,
  Slot,
} from './types';
import { SLOT_COLOR, TURN_ORDER_4 } from './types';

export const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function createGame(
  turnOrder: readonly Slot[] = TURN_ORDER_4,
  fen: string = START_FEN,
): GameState {
  if (!isValidTurnOrder(turnOrder)) {
    throw new Error(`turnOrder must alternate colors: ${turnOrder.join(',')}`);
  }
  return {
    fen,
    turnIndex: 0,
    turnOrder,
    moves: [],
    status: 'active',
    result: null,
  };
}

/**
 * A turn order is only coherent if consecutive entries alternate army, and the
 * cycle closes (even length). ["P1","P3","P2","P4"] holds; ["P1","P2"] does not,
 * because white would move twice in a row.
 */
export function isValidTurnOrder(turnOrder: readonly Slot[]): boolean {
  if (turnOrder.length < 2 || turnOrder.length % 2 !== 0) return false;
  if (new Set(turnOrder).size !== turnOrder.length) return false;
  return turnOrder.every((slot, i) => {
    const next = turnOrder[(i + 1) % turnOrder.length]!;
    return SLOT_COLOR[slot] !== SLOT_COLOR[next];
  });
}

/** Whose turn it is. The single fact the custom layer exists to enforce. */
export function slotToMove(state: GameState): Slot {
  return state.turnOrder[state.turnIndex % state.turnOrder.length]!;
}

export function colorToMove(state: GameState): 'w' | 'b' {
  return SLOT_COLOR[slotToMove(state)];
}

/** The other seat on the same army as `slot`, given the current rotation. */
export function teammateOf(
  slot: Slot,
  turnOrder: readonly Slot[],
): Slot | null {
  return (
    turnOrder.find((s) => s !== slot && SLOT_COLOR[s] === SLOT_COLOR[slot]) ??
    null
  );
}

export type ApplyResult =
  | { ok: true; state: GameState; move: MoveRecord }
  | { ok: false; reason: string };

/**
 * Validate and apply a move. Pure: returns a new state, never mutates.
 *
 * Rejection order matters — the turn gate is checked before legality so that an
 * out-of-turn player learns it is not their turn, rather than that their move
 * was illegal (which it may not have been).
 */
export function applyMove(
  state: GameState,
  intent: MoveIntent,
  by: Slot,
  now: number = Date.now(),
): ApplyResult {
  if (state.status !== 'active') {
    return { ok: false, reason: 'game is over' };
  }

  const expected = slotToMove(state);
  if (by !== expected) {
    return { ok: false, reason: `not ${by}'s turn — ${expected} to move` };
  }

  const chess = new Chess(state.fen);

  // Defence in depth: if the rotation and the position ever disagree about
  // which army is up, refuse rather than write a move that corrupts the log.
  if (chess.turn() !== SLOT_COLOR[by]) {
    return { ok: false, reason: 'turn order desynced from position' };
  }

  let move;
  try {
    move = chess.move({
      from: intent.from,
      to: intent.to,
      promotion: intent.promotion ?? 'q',
    });
  } catch {
    return { ok: false, reason: 'illegal move' };
  }
  if (!move) return { ok: false, reason: 'illegal move' };

  const record: MoveRecord = {
    san: move.san,
    from: move.from,
    to: move.to,
    by,
    fenAfter: chess.fen(),
    captured: (move.captured as PieceSymbol | undefined) ?? null,
    ts: now,
  };

  const { status, result } = outcomeOf(chess);

  return {
    ok: true,
    move: record,
    state: {
      ...state,
      fen: record.fenAfter,
      turnIndex: state.turnIndex + 1,
      moves: [...state.moves, record],
      status,
      result,
    },
  };
}

function outcomeOf(chess: Chess): {
  status: GameState['status'];
  result: Result | null;
} {
  if (chess.isCheckmate()) {
    // chess.turn() is the side to move, i.e. the side that has been mated.
    return { status: 'checkmate', result: chess.turn() === 'w' ? '0-1' : '1-0' };
  }
  // Stalemate first: chess.js reports it as a draw too, and we want the
  // specific status for display.
  if (chess.isStalemate()) return { status: 'stalemate', result: '1/2-1/2' };
  if (chess.isDraw()) return { status: 'draw', result: '1/2-1/2' };
  return { status: 'active', result: null };
}

/** Resignation. Phase 1 has no consent model — that arrives in Phase 5. */
export function resign(state: GameState, by: Slot): GameState {
  if (state.status !== 'active') return state;
  return {
    ...state,
    status: 'resigned',
    result: SLOT_COLOR[by] === 'w' ? '0-1' : '1-0',
  };
}

/** Legal destination squares from `square`, for board highlighting. */
export function legalTargets(fen: string, square: string): string[] {
  const chess = new Chess(fen);
  // chess.js throws on a malformed square rather than returning [].
  try {
    return chess
      .moves({ square: square as never, verbose: true })
      .map((m) => m.to);
  } catch {
    return [];
  }
}

/**
 * Candidate destinations for a future turn. Blockers, check and pawn captures
 * may change before then; applyMove checks the real position before execution.
 */
export function premoveTargets(fen: string, square: string): string[] {
  const chess = new Chess(fen);
  const piece = chess.get(square as never);
  if (!piece) return [];
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const targets: string[] = [];
  const castling = fen.split(' ')[2] ?? '-';

  for (let f = 0; f < 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const to = `${String.fromCharCode(97 + f)}${r}`;
      if (to === square || chess.get(to as never)?.color === piece.color) continue;
      const dx = Math.abs(f - file);
      const dy = Math.abs(r - rank);
      let possible = false;
      switch (piece.type) {
        case 'p': {
          const forward = (r - rank) * (piece.color === 'w' ? 1 : -1);
          possible = (forward === 1 && dx <= 1) ||
            (forward === 2 && dx === 0 && rank === (piece.color === 'w' ? 2 : 7));
          break;
        }
        case 'n': possible = dx * dy === 2; break;
        case 'b': possible = dx === dy; break;
        case 'r': possible = dx === 0 || dy === 0; break;
        case 'q': possible = dx === dy || dx === 0 || dy === 0; break;
        case 'k': {
          const home = piece.color === 'w' ? 1 : 8;
          const castle = square === `e${home}` && r === home &&
            ((f === 6 && castling.includes(piece.color === 'w' ? 'K' : 'k')) ||
             (f === 2 && castling.includes(piece.color === 'w' ? 'Q' : 'q')));
          possible = (dx <= 1 && dy <= 1) || castle;
          break;
        }
      }
      if (possible) targets.push(to);
    }
  }
  return targets;
}

export function isCheck(fen: string): boolean {
  return new Chess(fen).isCheck();
}

/** Square of the king for `color`, used to paint the check indicator. */
export function kingSquare(fen: string, color: 'w' | 'b'): string | null {
  for (const row of new Chess(fen).board()) {
    for (const sq of row) {
      if (sq && sq.type === 'k' && sq.color === color) return sq.square;
    }
  }
  return null;
}

export interface BoardSquare {
  square: string;
  type: PieceSymbol;
  color: 'w' | 'b';
}

/**
 * The position as an 8x8 grid, rank 8 first. Keeps chess.js confined to this
 * module — components render from this, never from a Chess instance.
 */
export function boardOf(fen: string): (BoardSquare | null)[][] {
  return new Chess(fen).board() as (BoardSquare | null)[][];
}

export function pieceAt(fen: string, square: string): BoardSquare | null {
  const piece = new Chess(fen).get(square as never);
  return piece ? { square, type: piece.type, color: piece.color } : null;
}

/**
 * Whether this move needs a promotion choice. Asked before the move is made,
 * so the picker can open instead of silently queening.
 */
export function isPromotion(fen: string, from: string, to: string): boolean {
  const piece = pieceAt(fen, from);
  if (!piece || piece.type !== 'p') return false;
  const rank = to[1];
  return piece.color === 'w' ? rank === '8' : rank === '1';
}
