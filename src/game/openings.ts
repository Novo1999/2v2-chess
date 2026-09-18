/**
 * Naming the opening that was played.
 *
 * A derived view of the move log and nothing else (decision #6) — no field is
 * added to the game node for it, and two clients watching the same game compute
 * the same name from the same moves.
 *
 * The table is keyed by position rather than by move sequence, so a line that
 * transposes is still recognised: 1.d4 d5 2.e4 e6 is the French, arrived at the
 * long way round. See scripts/build-openings.mjs for how it is generated.
 *
 * 3810 positions is 59KB over the wire, which is more than the rest of the app
 * and is needed only to print one line of text — so it is fetched on demand
 * rather than bundled into the initial load, and the name appears a moment
 * after the board does.
 */

import type { MoveRecord } from './types';

export interface Opening {
  /** ECO code, e.g. "B90". */
  eco: string;
  /** e.g. "Sicilian Defense: Najdorf Variation". */
  name: string;
  /** How many plies into the game the name was still book. */
  depth: number;
}

/** EPD (the first four FEN fields) -> "<eco> <name>". */
export type OpeningTable = Record<string, string>;

/** The key the table is built on. Must match epdOf in the build script. */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * The deepest opening the game passed through.
 *
 * Play continues past the book, so the answer is the *last* position that had
 * a name, not the first — and because a position that is not in the table
 * simply does not match, leaving book needs no explicit cutoff.
 */
export function nameOpening(
  table: OpeningTable,
  moves: readonly MoveRecord[],
): Opening | null {
  let found: Opening | null = null;

  for (const [ply, move] of moves.entries()) {
    const entry = table[positionKey(move.fenAfter)];
    if (!entry) continue;
    const cut = entry.indexOf(' ');
    found = {
      eco: entry.slice(0, cut),
      name: entry.slice(cut + 1),
      depth: ply + 1,
    };
  }

  return found;
}

let table: Promise<OpeningTable> | null = null;

/** Idempotent: the table is fetched once per tab and shared by every caller. */
export function loadOpenings(): Promise<OpeningTable> {
  if (!table) {
    table = import('./openings.data.json')
      .then((module) => module.default as OpeningTable)
      .catch((err: unknown) => {
        table = null; // let a later render try again
        throw err;
      });
  }
  return table;
}
