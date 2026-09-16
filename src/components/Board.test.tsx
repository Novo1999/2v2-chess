/**
 * The board is the one place where the rules layer meets a pointer, so these
 * assert the interaction contract rather than the chess: what is selectable,
 * what is offered as a destination, and that a click-pair reaches the log.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalGame } from '../LocalGame';
import { playMoveSound } from '../sound';

vi.mock('../sound', () => ({
  playMoveSound: vi.fn(),
  isMuted: () => false,
  setMuted: vi.fn(),
}));

function squares(container: HTMLElement, selector: string) {
  return Array.from(container.querySelectorAll(selector));
}

describe('the board', () => {
  it('draws sixty-four squares', () => {
    const { container } = render(<LocalGame />);
    expect(squares(container, '.sq')).toHaveLength(64);
  });

  it('offers the legal destinations of the piece you pick up', async () => {
    const user = userEvent.setup();
    const { container } = render(<LocalGame />);

    await user.click(screen.getByLabelText('e2'));

    const offered = squares(container, '.sq.target, .sq.capture').map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(offered.sort()).toEqual(['e3', 'e4']);
  });

  it('will not pick up a piece belonging to the army that is not on move', async () => {
    const user = userEvent.setup();
    const { container } = render(<LocalGame />);

    await user.click(screen.getByLabelText('e7'));

    expect(squares(container, '.sq.selected')).toHaveLength(0);
    expect(squares(container, '.sq.target')).toHaveLength(0);
  });

  it('plays a move and records it in the log and the PGN', async () => {
    const user = userEvent.setup();
    const { container } = render(<LocalGame />);

    await user.click(screen.getByLabelText('e2'));
    await user.click(screen.getByLabelText('e4'));

    expect(container.querySelector('.movelist')?.textContent).toContain('e4');
    expect(container.querySelector('.pgn')?.textContent).toBe('1. e4 *');
  });

  it('hands the turn to the next seat in the rotation', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);

    const onTurn = () => document.querySelector('.side-strip .seat.on-turn')?.textContent;

    expect(onTurn()).toContain('P1');
    await user.click(screen.getByLabelText('e2'));
    await user.click(screen.getByLabelText('e4'));

    // Four seats: white's P1 is followed by black's P3, not by white's P2.
    expect(onTurn()).toContain('P3');
  });
});

describe('move sounds', () => {
  beforeEach(() => vi.mocked(playMoveSound).mockClear());

  async function play(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
    await user.click(screen.getByLabelText(from));
    await user.click(screen.getByLabelText(to));
  }

  it('stays silent when a game is first shown', () => {
    render(<LocalGame />);
    expect(playMoveSound).not.toHaveBeenCalled();
  });

  it('plays the move sound for a quiet move', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);
    await play(user, 'e2', 'e4');
    expect(playMoveSound).toHaveBeenCalledTimes(1);
    expect(playMoveSound).toHaveBeenLastCalledWith('move');
  });

  it('plays the capture sound when a piece is taken', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);
    await play(user, 'e2', 'e4');
    await play(user, 'd7', 'd5');
    await play(user, 'e4', 'd5');
    expect(playMoveSound).toHaveBeenCalledTimes(3);
    expect(vi.mocked(playMoveSound).mock.calls.map((c) => c[0])).toEqual([
      'move',
      'move',
      'capture',
    ]);
  });

  it('does not play for a move the rules refuse', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);
    await play(user, 'e2', 'e5');
    expect(playMoveSound).not.toHaveBeenCalled();
  });
});

describe('the player list', () => {
  const current = () =>
    document.querySelector('.player-row.to-move')?.textContent;

  it('lists every seat in turn order and highlights the one to move', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);

    const rows = [...document.querySelectorAll('.player-row')].map((r) => r.textContent);
    expect(rows).toEqual(['P1', 'P3', 'P2', 'P4']);
    expect(current()).toBe('P1');

    await user.click(screen.getByLabelText('e2'));
    await user.click(screen.getByLabelText('e4'));
    expect(current()).toBe('P3');
    expect(document.querySelectorAll('.player-row.to-move')).toHaveLength(1);
  });
});

describe('checkmate', () => {
  const SCHOLARS: [string, string][] = [
    ['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'],
    ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7'],
  ];

  async function mate() {
    const user = userEvent.setup();
    render(<LocalGame />);
    for (const [from, to] of SCHOLARS) {
      await user.click(screen.getByLabelText(from));
      await user.click(screen.getByLabelText(to));
    }
    return user;
  }

  it('shows a result card naming the ending, the winner and the mating move', async () => {
    await mate();
    const card = document.querySelector('.result-card');
    expect(card?.textContent).toContain('Checkmate');
    expect(card?.textContent).toContain('White wins');
    // Half-move seven falls to P2, the teammate of the seat that brought the queen out.
    expect(card?.textContent).toContain('Qxf7# by P2');
    expect(card?.textContent).toContain('1-0');
  });

  it('marks the mated king and the winning king', async () => {
    await mate();
    expect(screen.getByLabelText('e8').classList.contains('mated')).toBe(true);
    expect(screen.getByLabelText('e8').querySelector('.badge-mated')).toBeTruthy();
    expect(screen.getByLabelText('e1').classList.contains('victor')).toBe(true);
  });

  it('can be put away to study the final position, keeping the king marks', async () => {
    const user = await mate();
    await user.click(screen.getByRole('button', { name: 'View board' }));
    expect(document.querySelector('.result-card')).toBeNull();
    expect(screen.getByLabelText('e8').classList.contains('mated')).toBe(true);
  });

  it('clears everything for a new game', async () => {
    const user = await mate();
    await user.click(screen.getByRole('button', { name: 'View board' }));
    await user.click(screen.getByRole('button', { name: 'New game' }));
    expect(document.querySelector('.result-card')).toBeNull();
    expect(document.querySelector('.sq.mated')).toBeNull();
  });
});

/**
 * Drag and right-click drawing work from pointer coordinates, which jsdom does
 * not lay out — so the board is given a fixed 800px box, one square per 100px.
 */
describe('pointer interaction', () => {
  function board() {
    const el = document.querySelector('.board') as HTMLElement;
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
    return el;
  }
  /** Centre of a square with white at the bottom. */
  function at(square: string) {
    const col = 'abcdefgh'.indexOf(square[0]!);
    const row = 8 - Number(square[1]);
    return { clientX: col * 100 + 50, clientY: row * 100 + 50 };
  }
  const moves = () => document.querySelector('.movelist')?.textContent ?? '';

  it('moves a piece dragged onto a legal square', () => {
    render(<LocalGame />);
    const el = board();
    fireEvent.pointerDown(screen.getByLabelText('e2'), { button: 0, pointerId: 1, ...at('e2') });
    fireEvent.pointerMove(el, { pointerId: 1, ...at('e3') });
    expect(document.querySelector('.drag-piece')).toBeTruthy();
    expect(screen.getByLabelText('e2').classList.contains('drag-origin')).toBe(true);
    fireEvent.pointerMove(el, { pointerId: 1, ...at('e4') });
    fireEvent.pointerUp(el, { button: 0, pointerId: 1, ...at('e4') });

    expect(moves()).toContain('e4');
    expect(document.querySelector('.drag-piece')).toBeNull();
  });

  it('snaps an illegal drop back and keeps the piece selected', () => {
    render(<LocalGame />);
    const el = board();
    fireEvent.pointerDown(screen.getByLabelText('e2'), { button: 0, pointerId: 1, ...at('e2') });
    fireEvent.pointerMove(el, { pointerId: 1, ...at('e5') });
    fireEvent.pointerUp(el, { button: 0, pointerId: 1, ...at('e5') });

    expect(document.querySelector('.movelist')).toBeNull(); // nothing was played
    expect(screen.getByLabelText('e2').classList.contains('selected')).toBe(true);
  });

  it('highlights a right-clicked square, and clears it on a second right-click', () => {
    render(<LocalGame />);
    const el = board();
    const rightClick = (square: string) => {
      fireEvent.pointerDown(screen.getByLabelText(square), { button: 2, pointerId: 2, ...at(square) });
      fireEvent.pointerUp(el, { button: 2, pointerId: 2, ...at(square) });
    };
    rightClick('d4');
    expect(screen.getByLabelText('d4').querySelector('.sq-mark')).toBeTruthy();
    rightClick('d4');
    expect(screen.getByLabelText('d4').querySelector('.sq-mark')).toBeNull();
  });

  it('draws an arrow on right-drag, and a left click clears everything', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);
    const el = board();
    fireEvent.pointerDown(screen.getByLabelText('g1'), { button: 2, pointerId: 2, ...at('g1') });
    fireEvent.pointerMove(el, { pointerId: 2, ...at('f3') });
    fireEvent.pointerUp(el, { button: 2, pointerId: 2, ...at('f3') });
    expect(document.querySelectorAll('.annotations .arrow')).toHaveLength(1);

    await user.click(screen.getByLabelText('a5'));
    expect(document.querySelector('.annotations')).toBeNull();
  });

  it('never moves a piece on a right-drag', () => {
    render(<LocalGame />);
    const el = board();
    fireEvent.pointerDown(screen.getByLabelText('e2'), { button: 2, pointerId: 2, ...at('e2') });
    fireEvent.pointerMove(el, { pointerId: 2, ...at('e4') });
    fireEvent.pointerUp(el, { button: 2, pointerId: 2, ...at('e4') });
    expect(document.querySelector('.movelist')).toBeNull(); // nothing was played
  });
});
