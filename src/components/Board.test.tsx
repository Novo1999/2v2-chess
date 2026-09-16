/**
 * The board is the one place where the rules layer meets a pointer, so these
 * assert the interaction contract rather than the chess: what is selectable,
 * what is offered as a destination, and that a click-pair reaches the log.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LocalGame } from '../LocalGame';

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

    expect(screen.getByText('P1')).toBeTruthy();
    await user.click(screen.getByLabelText('e2'));
    await user.click(screen.getByLabelText('e4'));

    // Four seats: white's P1 is followed by black's P3, not by white's P2.
    expect(screen.getByText('P3')).toBeTruthy();
    expect(screen.queryByText('P2')).toBeNull();
  });
});
