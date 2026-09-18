import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LocalGame } from './LocalGame';
import { pieceUrl } from './components/pieces';

vi.mock('./sound', () => ({
  playMoveSound: vi.fn(),
  isMuted: () => false,
  setMuted: vi.fn(),
}));

const boardClass = () => document.querySelector('.game')?.className ?? '';
// Vite inlines small SVGs as data URIs, so compare against the set's own URL
// rather than looking for a folder name in the path.
/**
 * One option in a ChoiceGroup, which renders toggle buttons. Scoped to its own
 * group, because "Classic" names both a board and a piece set.
 */
const chooser = (group: string, name: RegExp) =>
  within(screen.getByLabelText(group)).getByRole('button', { name });
const e1King = () => screen.getByLabelText('e1').querySelector('img.piece')?.getAttribute('src') ?? '';

describe('board and piece choices', () => {
  it('starts on the Classic board with Classic pieces', () => {
    render(<LocalGame />);
    expect(boardClass()).toContain('board-theme-classic');
    expect(e1King()).toBe(pieceUrl('classic', 'w', 'k'));
    // A toggle group reports the chosen option with aria-pressed.
    expect(chooser('Board', /Dark wood/).getAttribute('aria-pressed')).toBe('false');
    expect(chooser('Board', /Classic/).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches the board and pieces at once and remembers both', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);

    await user.click(chooser('Board', /Walnut/));
    await user.click(chooser('Pieces', /Wood/));

    expect(boardClass()).toContain('board-theme-walnut');
    expect(e1King()).toBe(pieceUrl('wood', 'w', 'k'));
    expect(localStorage.getItem('consultation-chess:board')).toBe('walnut');
    expect(localStorage.getItem('consultation-chess:pieces')).toBe('wood');

    await user.click(chooser('Pieces', /Neo/));
    expect(e1King()).toBe(pieceUrl('neo', 'w', 'k'));
  });
});
