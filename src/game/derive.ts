/**
 * Everything that is a pure function of the move log.
 *
 * Per PLAN.md decision #6 these are computed, never stored. Each one of them
 * that became a field would be another value the security rules had to defend
 * against a lying client.
 */

import type { Color, MoveRecord, PieceSymbol, Result } from './types';
import { SLOT_COLOR } from './types';

export const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

/** Pieces taken *by* each side. `tray.w` holds black pieces white has captured. */
export interface CapturedTray {
  w: PieceSymbol[];
  b: PieceSymbol[];
}

export function capturedTray(moves: readonly MoveRecord[]): CapturedTray {
  const tray: CapturedTray = { w: [], b: [] };
  for (const move of moves) {
    if (move.captured) tray[SLOT_COLOR[move.by]].push(move.captured);
  }
  tray.w.sort(byValueDesc);
  tray.b.sort(byValueDesc);
  return tray;
}

function byValueDesc(a: PieceSymbol, b: PieceSymbol): number {
  return PIECE_VALUE[b] - PIECE_VALUE[a];
}

/** Positive favours white. */
export function materialBalance(tray: CapturedTray): number {
  const sum = (pieces: PieceSymbol[]) =>
    pieces.reduce((total, p) => total + PIECE_VALUE[p], 0);
  return sum(tray.w) - sum(tray.b);
}

export interface MovePair {
  number: number;
  white: MoveRecord | null;
  black: MoveRecord | null;
}

/**
 * Group the flat log into numbered pairs for display. Colour comes from the
 * moving slot, not from the index, so this stays correct if a game ever starts
 * from a black-to-move position.
 */
export function movePairs(moves: readonly MoveRecord[]): MovePair[] {
  const pairs: MovePair[] = [];
  for (const move of moves) {
    const color: Color = SLOT_COLOR[move.by];
    const last = pairs[pairs.length - 1];
    if (color === 'w' || !last || last.black !== null) {
      pairs.push({
        number: pairs.length + 1,
        white: color === 'w' ? move : null,
        black: color === 'b' ? move : null,
      });
    } else {
      last.black = move;
    }
  }
  return pairs;
}

export function toPgn(
  moves: readonly MoveRecord[],
  result: Result | null,
): string {
  const body = movePairs(moves)
    .map(({ number, white, black }) =>
      [`${number}.`, white?.san, black?.san].filter(Boolean).join(' '),
    )
    .join(' ');
  return [body, result ?? '*'].filter(Boolean).join(' ').trim();
}
