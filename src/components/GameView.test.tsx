/**
 * Move history, the check sound, time-outs and presence: what the players can
 * see about the game beyond the position itself.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalGame } from '../LocalGame';
import { GameView } from './GameView';
import { Clock } from './Clock';
import { applyMove, createGame, slotToMove } from '../game/rules';
import type { GameState, MoveIntent } from '../game/types';
import { playMoveSound } from '../sound';

vi.mock('../sound', () => ({
  playMoveSound: vi.fn(),
  isMuted: () => false,
  setMuted: vi.fn(),
}));

beforeEach(() => vi.mocked(playMoveSound).mockClear());

type User = ReturnType<typeof userEvent.setup>;

async function play(user: User, ...moves: [string, string][]) {
  for (const [from, to] of moves) {
    await user.click(screen.getByLabelText(from));
    await user.click(screen.getByLabelText(to));
  }
}

const pieceOn = (square: string) =>
  screen.getByLabelText(square).querySelector('img.piece')?.getAttribute('alt') ?? null;
const browsing = () => document.querySelector('.board-wrap')!.classList.contains('browsing');

/** A game state reached by playing moves through the rules layer. */
function stateAfter(moves: MoveIntent[]): GameState {
  let state = createGame();
  for (const move of moves) {
    const result = applyMove(state, move, slotToMove(state));
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
  }
  return state;
}

describe('check sound', () => {
  it('plays the check sound for a move that gives check', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);
    await play(user, ['e2', 'e4'], ['f7', 'f5'], ['d1', 'h5']);
    expect(vi.mocked(playMoveSound).mock.calls.map((c) => c[0])).toEqual([
      'move',
      'move',
      'check',
    ]);
  });
});

describe('move history', () => {
  it('shows an earlier position when a move in the list is clicked', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);
    await play(user, ['e2', 'e4'], ['e7', 'e5']);

    await user.click(screen.getByRole('button', { name: /^e4/ }));

    expect(browsing()).toBe(true);
    expect(pieceOn('e4')).toBe('white pawn');
    expect(pieceOn('e5')).toBeNull();
    expect(pieceOn('e7')).toBe('black pawn');
    expect(screen.getByRole('button', { name: /^e4/ }).getAttribute('aria-current')).toBe('true');
  });

  it('steps with the arrow buttons, back to the start and forward to live', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);
    await play(user, ['e2', 'e4'], ['e7', 'e5']);

    await user.click(screen.getByRole('button', { name: 'Previous move' }));
    await user.click(screen.getByRole('button', { name: 'Previous move' }));
    expect(pieceOn('e2')).toBe('white pawn');
    expect((screen.getByRole('button', { name: 'First move' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Next move' }));
    expect(pieceOn('e4')).toBe('white pawn');
    expect(pieceOn('e7')).toBe('black pawn');

    await user.click(screen.getByRole('button', { name: 'Latest move' }));
    expect(browsing()).toBe(false);
    expect(pieceOn('e5')).toBe('black pawn');
  });

  it('steps with the left and right arrow keys', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);
    await play(user, ['e2', 'e4'], ['e7', 'e5']);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(pieceOn('e5')).toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(browsing()).toBe(false);
    expect(pieceOn('e5')).toBe('black pawn');
  });

  it('will not let a piece be moved on an earlier position', async () => {
    const user = userEvent.setup();
    const { container } = render(<LocalGame />);
    await play(user, ['e2', 'e4'], ['e7', 'e5']);

    await user.click(screen.getByRole('button', { name: 'First move' }));
    await user.click(screen.getByLabelText('d2'));

    expect(container.querySelectorAll('.sq.selected, .sq.target')).toHaveLength(0);
  });
});

describe('time out', () => {
  const flagged: GameState = { ...stateAfter([{ from: 'e2', to: 'e4' }]), status: 'timeout', result: '1-0' };

  it('marks the king of the side that ran out of time', () => {
    render(<GameView state={flagged} controls={[]} orientation="w" onMove={() => {}} />);
    expect(screen.getByLabelText('e8').classList.contains('flagged')).toBe(true);
    expect(screen.getByLabelText('e8').querySelector('.badge-flagged')).toBeTruthy();
    expect(screen.getByLabelText('e1').classList.contains('victor')).toBe(true);
  });

  it('says so on the result card, naming the seat that was on move', () => {
    render(
      <GameView
        state={flagged}
        controls={[]}
        names={{ P3: 'Rafi', P4: 'Mitu' }}
        orientation="w"
        onMove={() => {}}
      />,
    );
    const card = document.querySelector('.result-card')!;
    expect(card.textContent).toContain('Out of time');
    expect(card.textContent).toContain("Rafi & Mitu ran out of time on Rafi's move");
    expect(card.querySelector('.result-icon')).toBeTruthy();
  });

  it('shows a fallen clock as timed out, even before the flag is recorded', () => {
    const { rerender } = render(<Clock ms={0} army="w" running />);
    expect(screen.getByRole('status').textContent).toBe('Time out');
    rerender(<Clock ms={5000} army="w" running={false} flagged />);
    expect(document.querySelector('.clock.flagged')).toBeTruthy();
    rerender(<Clock ms={8000} army="w" running />);
    expect(document.querySelector('.clock.critical')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('presence', () => {
  it('shows who is connected and who has dropped out', () => {
    render(
      <GameView
        state={createGame()}
        controls={[]}
        presence={{ P1: true, P2: true, P3: false, P4: true }}
        orientation="w"
        onMove={() => {}}
      />,
    );
    const row = (slot: string) =>
      [...document.querySelectorAll('.player-row')].find((r) => r.textContent?.startsWith(slot))!;

    expect(row('P1').querySelector('[aria-label="Connected"]')).toBeTruthy();
    expect(row('P3').querySelector('[aria-label="Disconnected"]')).toBeTruthy();
    expect(row('P3').classList.contains('offline')).toBe(true);
    expect(row('P4').classList.contains('offline')).toBe(false);
  });

  it('shows nothing in hot seat, where nobody can be away', () => {
    render(<LocalGame />);
    expect(document.querySelector('.presence')).toBeNull();
  });
});
