import { describe, expect, it } from 'vitest';
import {
  applyMove,
  createGame,
  isValidTurnOrder,
  legalTargets,
  resign,
  slotToMove,
  teammateOf,
} from './rules';
import { capturedTray, materialBalance, movePairs, toPgn } from './derive';
import type { GameState, Slot } from './types';
import { TURN_ORDER_2, TURN_ORDER_4 } from './types';

/** Play a sequence as whoever is legitimately up, asserting each move lands. */
function play(state: GameState, sans: [string, string][]): GameState {
  for (const [from, to] of sans) {
    const result = applyMove(state, { from, to }, slotToMove(state));
    if (!result.ok) throw new Error(`${from}${to}: ${result.reason}`);
    state = result.state;
  }
  return state;
}

const SCHOLARS: [string, string][] = [
  ['e2', 'e4'],
  ['e7', 'e5'],
  ['f1', 'c4'],
  ['b8', 'c6'],
  ['d1', 'h5'],
  ['g8', 'f6'],
  ['h5', 'f7'],
];

describe('turn order', () => {
  it('accepts rotations that alternate armies', () => {
    expect(isValidTurnOrder(TURN_ORDER_2)).toBe(true);
    expect(isValidTurnOrder(TURN_ORDER_4)).toBe(true);
  });

  it('rejects rotations that let one army move twice in a row', () => {
    expect(isValidTurnOrder(['P1', 'P2'])).toBe(false);
    expect(isValidTurnOrder(['P1', 'P3', 'P2'])).toBe(false);
    expect(isValidTurnOrder(['P1', 'P3', 'P1', 'P3'])).toBe(false);
    expect(isValidTurnOrder(['P1'])).toBe(false);
  });

  it('rotates through all four seats and wraps', () => {
    let state = createGame(TURN_ORDER_4);
    const seen: Slot[] = [];
    for (const move of SCHOLARS.slice(0, 5)) {
      seen.push(slotToMove(state));
      state = play(state, [move]);
    }
    expect(seen).toEqual(['P1', 'P3', 'P2', 'P4', 'P1']);
  });

  it('pairs each seat with the other holder of its army', () => {
    expect(teammateOf('P1', TURN_ORDER_4)).toBe('P2');
    expect(teammateOf('P4', TURN_ORDER_4)).toBe('P3');
    expect(teammateOf('P1', TURN_ORDER_2)).toBe(null);
  });
});

describe('the turn gate', () => {
  it("rejects a teammate moving out of turn, even with a legal move", () => {
    const state = createGame(TURN_ORDER_4);
    // P2 shares white with P1 and e4 is legal, but P1 is up.
    const result = applyMove(state, { from: 'e2', to: 'e4' }, 'P2');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/not P2's turn/);
  });

  it('rejects an opponent moving out of turn', () => {
    const state = createGame(TURN_ORDER_4);
    const result = applyMove(state, { from: 'e7', to: 'e5' }, 'P3');
    expect(result.ok).toBe(false);
  });

  it('reports out-of-turn before illegality, so the reason is accurate', () => {
    const state = createGame(TURN_ORDER_4);
    const result = applyMove(state, { from: 'e2', to: 'e5' }, 'P2');
    expect(result.ok === false && result.reason).toMatch(/not P2's turn/);
  });

  it('rejects an illegal move from the correct seat', () => {
    const state = createGame(TURN_ORDER_4);
    const result = applyMove(state, { from: 'e2', to: 'e5' }, 'P1');
    expect(result.ok === false && result.reason).toBe('illegal move');
  });

  it('rejects moving from an empty square', () => {
    const state = createGame(TURN_ORDER_4);
    const result = applyMove(state, { from: 'e5', to: 'e6' }, 'P1');
    expect(result.ok).toBe(false);
  });

  it('leaves state untouched on rejection', () => {
    const state = createGame(TURN_ORDER_4);
    applyMove(state, { from: 'e2', to: 'e4' }, 'P2');
    expect(state.turnIndex).toBe(0);
    expect(state.moves).toHaveLength(0);
  });
});

describe('the move log', () => {
  it('advances turnIndex by exactly one per move', () => {
    let state = createGame(TURN_ORDER_4);
    for (let i = 0; i < SCHOLARS.length; i++) {
      expect(state.turnIndex).toBe(i);
      state = play(state, [SCHOLARS[i]!]);
    }
  });

  it('appends without mutating earlier entries', () => {
    const before = play(createGame(TURN_ORDER_4), SCHOLARS.slice(0, 2));
    const first = before.moves[0]!;
    const after = play(before, SCHOLARS.slice(2, 4));
    expect(after.moves).toHaveLength(4);
    expect(after.moves[0]).toBe(first);
    expect(before.moves).toHaveLength(2);
  });

  it('records the position after each move, so FEN is a pure cache', () => {
    const state = play(createGame(TURN_ORDER_4), SCHOLARS);
    expect(state.fen).toBe(state.moves[state.moves.length - 1]!.fenAfter);
  });

  it('records the capturing seat, not just the captured piece', () => {
    const state = play(createGame(TURN_ORDER_4), SCHOLARS);
    const capture = state.moves.find((m) => m.captured !== null)!;
    expect(capture.san).toBe('Qxf7#');
    expect(capture.captured).toBe('p');
    expect(capture.by).toBe('P1');
  });
});

describe('outcomes', () => {
  it('detects checkmate and awards the game to the mating side', () => {
    const state = play(createGame(TURN_ORDER_4), SCHOLARS);
    expect(state.status).toBe('checkmate');
    expect(state.result).toBe('1-0');
  });

  it('refuses further moves once the game is over', () => {
    const state = play(createGame(TURN_ORDER_4), SCHOLARS);
    const result = applyMove(state, { from: 'e8', to: 'f7' }, slotToMove(state));
    expect(result.ok === false && result.reason).toBe('game is over');
  });

  it('detects stalemate as a draw distinct from other draws', () => {
    const state = createGame(TURN_ORDER_2, '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
    const after = play(state, [['f7', 'g7']]);
    expect(after.status).toBe('stalemate');
    expect(after.result).toBe('1/2-1/2');
  });

  it('awards the game to the opposing army on resignation', () => {
    const state = resign(createGame(TURN_ORDER_4), 'P2');
    expect(state.status).toBe('resigned');
    expect(state.result).toBe('0-1');
  });
});

describe('derived views', () => {
  it('credits captures to the capturing army', () => {
    const state = play(createGame(TURN_ORDER_4), SCHOLARS);
    expect(capturedTray(state.moves)).toEqual({ w: ['p'], b: [] });
    expect(materialBalance(capturedTray(state.moves))).toBe(1);
  });

  it('numbers move pairs by full move, not by log index', () => {
    const state = play(createGame(TURN_ORDER_4), SCHOLARS);
    const pairs = movePairs(state.moves);
    expect(pairs).toHaveLength(4);
    expect(pairs[0]!.white!.san).toBe('e4');
    expect(pairs[0]!.black!.san).toBe('e5');
    expect(pairs[3]!.black).toBe(null);
  });

  it('renders PGN from the log alone', () => {
    const state = play(createGame(TURN_ORDER_4), SCHOLARS);
    expect(toPgn(state.moves, state.result)).toBe(
      '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0',
    );
  });

  it('marks an unfinished game with *', () => {
    const state = play(createGame(TURN_ORDER_4), SCHOLARS.slice(0, 2));
    expect(toPgn(state.moves, state.result)).toBe('1. e4 e5 *');
  });
});

describe('highlighting', () => {
  it('lists legal destinations for a square', () => {
    const state = createGame(TURN_ORDER_4);
    expect(legalTargets(state.fen, 'e2').sort()).toEqual(['e3', 'e4']);
    expect(legalTargets(state.fen, 'e4')).toEqual([]);
  });

  it('returns nothing for a malformed square rather than throwing', () => {
    expect(legalTargets(createGame().fen, 'z9')).toEqual([]);
  });
});
