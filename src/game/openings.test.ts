import { beforeAll, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { nameOpening, positionKey, loadOpenings, type OpeningTable } from './openings';
import type { MoveRecord, Slot } from './types';
import { TURN_ORDER_4 } from './types';

/** Play a SAN line and produce the move log it would have written. */
function log(...sans: string[]): MoveRecord[] {
  const chess = new Chess();
  return sans.map((san, ply) => {
    const move = chess.move(san);
    return {
      san: move.san,
      from: move.from,
      to: move.to,
      by: TURN_ORDER_4[ply % TURN_ORDER_4.length] as Slot,
      fenAfter: chess.fen(),
      captured: null,
      ts: 0,
    };
  });
}

let table: OpeningTable;
beforeAll(async () => {
  table = await loadOpenings();
});

describe('naming the opening', () => {
  it('has no name before a move is played', () => {
    expect(nameOpening(table, [])).toBeNull();
  });

  it('names a mainline opening', () => {
    expect(nameOpening(table, log('e4', 'e5', 'Nf3', 'Nc6', 'Bc4'))?.name).toBe(
      'Italian Game',
    );
  });

  it('carries the ECO code', () => {
    expect(nameOpening(table, log('e4', 'c5'))?.eco).toBe('B20');
  });

  it('names the deepest variation reached, not the first', () => {
    const najdorf = nameOpening(
      table,
      log('e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'),
    );
    expect(najdorf?.name).toBe('Sicilian Defense: Najdorf Variation');
    expect(najdorf?.depth).toBe(10);
  });

  it('recognises a transposition, because the table is keyed by position', () => {
    const direct = nameOpening(table, log('e4', 'e6', 'd4', 'd5'));
    const transposed = nameOpening(table, log('d4', 'd5', 'e4', 'e6'));
    expect(direct?.name).toBe('French Defense');
    expect(transposed?.name).toBe(direct?.name);
  });

  it('keeps the last book name once the game leaves theory', () => {
    // Italian at ply 5, then seven plies no book has a name for.
    const named = nameOpening(
      table,
      log('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Qf6', 'd3', 'h6', 'Be3', 'a6', 'Nc3', 'b5'),
    );
    expect(named?.name).toBe('Italian Game');
    expect(named?.depth).toBe(5);
  });

  it('re-names a line that wanders back into a book position', () => {
    // The knight and queen return whence they came, so the position after ply
    // 9 IS the Italian position - keyed by position, the name comes back.
    const named = nameOpening(
      table,
      log('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Qe7', 'Ng1', 'Qd8', 'Nf3'),
    );
    expect(named?.name).toBe('Italian Game');
    expect(named?.depth).toBe(9);
  });

  it('ignores the move counters, which do not change the position', () => {
    expect(positionKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 12 34')).toBe(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    );
  });
});
