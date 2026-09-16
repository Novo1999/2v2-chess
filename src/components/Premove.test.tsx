import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GameView } from './GameView';
import { applyMove, createGame, slotToMove } from '../game/rules';
import type { GameState, MoveIntent, Slot } from '../game/types';
import { TURN_ORDER_2 } from '../game/types';

vi.mock('../sound', () => ({
  playMoveSound: vi.fn(),
  isMuted: () => false,
  setMuted: vi.fn(),
}));

function advance(state: GameState, from: string, to: string): GameState {
  const result = applyMove(state, { from, to }, slotToMove(state));
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function view(state: GameState, you: Slot | null, onMove: (move: MoveIntent) => void, controls?: Slot[]) {
  return (
    <StrictMode>
      <GameView
        state={state}
        controls={controls ?? (you && slotToMove(state) === you ? [you] : [])}
        you={you}
        orientation={you === 'P3' || you === 'P4' ? 'b' : 'w'}
        onMove={onMove}
      />
    </StrictMode>
  );
}

async function select(from: string, to: string) {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(from));
  await user.click(screen.getByLabelText(to));
}

function highlighted() {
  return [...document.querySelectorAll('.sq.premove')].map((el) => el.getAttribute('data-square')).sort();
}

function dragBoard() {
  const board = document.querySelector('.board') as HTMLElement;
  board.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return board;
}

describe('premoves', () => {
  it('highlights a queued move without playing it, then plays it once on the next turn', async () => {
    const onMove = vi.fn();
    const state = createGame(TURN_ORDER_2);
    const { rerender } = render(view(state, 'P3', onMove));
    await select('e7', 'e5');

    expect(onMove).not.toHaveBeenCalled();
    expect(highlighted()).toEqual(['e5', 'e7']);
    expect(screen.getByRole('status').textContent).toBe('Premove: e7 → e5');
    expect(screen.getByLabelText('e7').querySelector('.piece')?.getAttribute('alt')).toBe('black pawn');

    const next = advance(state, 'e2', 'e4');
    rerender(view(next, 'P3', onMove));
    rerender(view({ ...next }, 'P3', onMove));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ from: 'e7', to: 'e5' });
    expect(highlighted()).toEqual([]);
  });

  it('waits for your seat through your teammate’s turn, even if takeover becomes available', async () => {
    const onMove = vi.fn();
    let state = advance(createGame(), 'e2', 'e4');
    const { rerender } = render(view(state, 'P1', onMove));
    await select('g1', 'f3');

    state = advance(state, 'e7', 'e5');
    rerender(view(state, 'P1', onMove, ['P2']));
    expect(onMove).not.toHaveBeenCalled();
    expect(highlighted()).toEqual(['f3', 'g1']);
    state = advance(state, 'b1', 'c3');
    rerender(view(state, 'P1', onMove));
    expect(onMove).not.toHaveBeenCalled();
    state = advance(state, 'b8', 'c6');
    rerender(view(state, 'P1', onMove));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ from: 'g1', to: 'f3' });
  });

  it('discards a premove that no longer answers check', async () => {
    const onMove = vi.fn();
    const state = createGame(TURN_ORDER_2, '4k3/4p3/8/8/8/8/8/K2R4 w - - 0 1');
    const { rerender } = render(view(state, 'P3', onMove));
    await select('e7', 'e5');
    expect(highlighted()).toEqual(['e5', 'e7']);

    rerender(view(advance(state, 'd1', 'd8'), 'P3', onMove));
    expect(onMove).not.toHaveBeenCalled();
    expect(highlighted()).toEqual([]);
  });

  it('can anticipate a pawn capture on a currently empty square', async () => {
    const onMove = vi.fn();
    const state = createGame(TURN_ORDER_2, '4k3/8/8/3p4/8/4P3/8/4K3 w - - 0 1');
    const { rerender } = render(view(state, 'P3', onMove));
    await select('d5', 'e4');
    expect(highlighted()).toEqual(['d5', 'e4']);
    rerender(view(advance(state, 'e3', 'e4'), 'P3', onMove));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ from: 'd5', to: 'e4' });
  });

  it('remembers the chosen promotion piece', async () => {
    const onMove = vi.fn();
    const state = createGame(TURN_ORDER_2, '4k3/8/8/8/8/8/p7/4K3 w - - 0 1');
    const { rerender } = render(view(state, 'P3', onMove));
    await select('a2', 'a1');
    await userEvent.setup().click(screen.getByRole('button', { name: 'black knight' }));
    expect(highlighted()).toEqual(['a1', 'a2']);
    expect(onMove).not.toHaveBeenCalled();
    rerender(view(advance(state, 'e1', 'f1'), 'P3', onMove));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ from: 'a2', to: 'a1', promotion: 'n' });
  });

  it('can anticipate an en passant capture', async () => {
    const onMove = vi.fn();
    const state = createGame(TURN_ORDER_2, '4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1');
    const { rerender } = render(view(state, 'P3', onMove));
    await select('d4', 'e3');
    rerender(view(advance(state, 'e2', 'e4'), 'P3', onMove));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ from: 'd4', to: 'e3' });
  });

  it.each(['c8', 'g8'])('supports castling to %s', async (to) => {
    const onMove = vi.fn();
    const state = createGame(TURN_ORDER_2, 'r3k2r/8/8/8/8/8/8/4K3 w kq - 0 1');
    const { rerender } = render(view(state, 'P3', onMove));
    await select('e8', to);
    expect(highlighted()).toEqual(['e8', to].sort());
    rerender(view(advance(state, 'e1', 'f1'), 'P3', onMove));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ from: 'e8', to });
  });

  it.each([true, false])('checks sliding-piece blockers at execution (path clears: %s)', async (clears) => {
    const onMove = vi.fn();
    let state = advance(createGame(), 'd2', 'd4');
    const { rerender } = render(view(state, 'P4', onMove));
    await select('f8', 'b4');
    expect(highlighted()).toEqual(['b4', 'f8']);
    state = advance(state, clears ? 'e7' : 'a7', clears ? 'e6' : 'a6');
    rerender(view(state, 'P4', onMove));
    state = advance(state, 'c2', 'c4');
    rerender(view(state, 'P4', onMove));
    if (clears) expect(onMove).toHaveBeenCalledExactlyOnceWith({ from: 'f8', to: 'b4' });
    else expect(onMove).not.toHaveBeenCalled();
    expect(highlighted()).toEqual([]);
  });

  it('queues a dragged move on a board viewed from black’s side', () => {
    const onMove = vi.fn();
    render(view(createGame(), 'P3', onMove));
    const board = dragBoard();
    fireEvent.pointerDown(screen.getByLabelText('e7'), { button: 0, pointerId: 1, clientX: 350, clientY: 650 });
    fireEvent.pointerMove(board, { buttons: 1, pointerId: 1, clientX: 350, clientY: 450 });
    fireEvent.pointerUp(board, { button: 0, pointerId: 1, clientX: 350, clientY: 450 });
    expect(highlighted()).toEqual(['e5', 'e7']);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('right-click cancels an in-progress premove drag', () => {
    const onMove = vi.fn();
    const state = createGame();
    const { rerender } = render(view(state, 'P3', onMove));
    const board = dragBoard();
    fireEvent.pointerDown(screen.getByLabelText('e7'), { button: 0, pointerId: 1, clientX: 350, clientY: 650 });
    fireEvent.pointerMove(board, { buttons: 1, pointerId: 1, clientX: 350, clientY: 450 });
    fireEvent.pointerMove(board, { button: 2, buttons: 3, pointerId: 1, clientX: 350, clientY: 450 });
    fireEvent.pointerUp(board, { button: 0, pointerId: 1, clientX: 350, clientY: 450 });
    expect(highlighted()).toEqual([]);
    expect(document.querySelector('.drag-piece, .selected')).toBeNull();
    rerender(view(advance(state, 'e2', 'e4'), 'P3', onMove));
    expect(onMove).not.toHaveBeenCalled();
  });

  it.each(['right-click', 'button', 'left-click'])('cancels a queued premove using %s', async (action) => {
    const onMove = vi.fn();
    const state = createGame();
    const { rerender } = render(view(state, 'P3', onMove));
    await select('e7', 'e5');
    if (action === 'right-click') {
      const square = screen.getByLabelText('d4');
      fireEvent.pointerDown(square, { button: 2, pointerId: 2 });
      fireEvent.pointerUp(square, { button: 2, pointerId: 2 });
      expect(document.querySelector('.sq-mark')).toBeNull();
    } else if (action === 'button') {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel premove' }));
    } else {
      await userEvent.setup().click(screen.getByLabelText('d4'));
    }
    expect(highlighted()).toEqual([]);
    rerender(view(advance(state, 'e2', 'e4'), 'P3', onMove));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('replaces the previous premove', async () => {
    const onMove = vi.fn();
    const state = createGame();
    const { rerender } = render(view(state, 'P3', onMove));
    await select('e7', 'e5');
    await select('d7', 'd5');
    expect(highlighted()).toEqual(['d5', 'd7']);
    rerender(view(advance(state, 'e2', 'e4'), 'P3', onMove));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ from: 'd7', to: 'd5' });
  });

  it.each(['resigned', 'timeout', 'draw'] as const)('clears the premove when the game ends by %s', async (status) => {
    const onMove = vi.fn();
    const state = createGame();
    const { rerender } = render(view(state, 'P3', onMove));
    await select('e7', 'e5');
    rerender(view({ ...state, status, result: '1/2-1/2' }, 'P3', onMove));
    expect(highlighted()).toEqual([]);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('clears a premove if the player loses their seat', async () => {
    const onMove = vi.fn();
    const state = createGame();
    const { rerender } = render(view(state, 'P3', onMove));
    await select('e7', 'e5');
    rerender(view(state, null, onMove));
    expect(highlighted()).toEqual([]);
    rerender(view(advance(state, 'e2', 'e4'), 'P3', onMove));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('clears a premove if its source is captured', async () => {
    const onMove = vi.fn();
    const state = createGame(TURN_ORDER_2, '4k3/4p3/8/8/8/8/8/K3R3 w - - 0 1');
    const { rerender } = render(view(state, 'P3', onMove));
    await select('e7', 'e5');
    rerender(view(advance(state, 'e1', 'e7'), 'P3', onMove));
    expect(highlighted()).toEqual([]);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('clears a premove when browsing history and does not restore it on returning live', async () => {
    const onMove = vi.fn();
    let state = advance(createGame(), 'e2', 'e4');
    state = advance(state, 'e7', 'e5');
    const { rerender } = render(view(state, 'P3', onMove));
    await select('b8', 'c6');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'First move' }));
    expect(highlighted()).toEqual([]);
    await select('e7', 'e5');
    expect(highlighted()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Latest move' }));
    state = advance(state, 'b1', 'c3');
    state = advance(state, 'g8', 'f6');
    state = advance(state, 'g1', 'f3');
    rerender(view(state, 'P3', onMove));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('discards a premove on a new game or a rolled-back position', async () => {
    const onMove = vi.fn();
    const state = advance(createGame(), 'e2', 'e4');
    const { rerender } = render(view(state, 'P1', onMove));
    await select('g1', 'f3');
    rerender(view(createGame(), 'P1', onMove));
    expect(highlighted()).toEqual([]);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('does not let spectators queue moves or let players select the other army', async () => {
    const onMove = vi.fn();
    const state = createGame();
    const { rerender } = render(view(state, null, onMove));
    await select('e7', 'e5');
    expect(highlighted()).toEqual([]);
    rerender(view(state, 'P3', onMove));
    await select('e2', 'e4');
    expect(highlighted()).toEqual([]);
    expect(document.querySelector('.sq.selected')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });
});
