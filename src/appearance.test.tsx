import { render, screen } from '@testing-library/react';
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
const e1King = () => screen.getByLabelText('e1').querySelector('img.piece')?.getAttribute('src') ?? '';

describe('board and piece choices', () => {
  it('starts on the Classic board with Classic pieces', () => {
    render(<LocalGame />);
    expect(boardClass()).toContain('board-theme-classic');
    expect(e1King()).toBe(pieceUrl('classic', 'w', 'k'));
    expect(screen.getByRole('radio', { name: /Dark wood/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('switches the board and pieces at once and remembers both', async () => {
    const user = userEvent.setup();
    render(<LocalGame />);

    await user.click(screen.getByRole('radio', { name: /Walnut/ }));
    await user.click(screen.getByRole('radio', { name: /Wood/ }));

    expect(boardClass()).toContain('board-theme-walnut');
    expect(e1King()).toBe(pieceUrl('wood', 'w', 'k'));
    expect(localStorage.getItem('consultation-chess:board')).toBe('walnut');
    expect(localStorage.getItem('consultation-chess:pieces')).toBe('wood');

    await user.click(screen.getByRole('radio', { name: /Neo/ }));
    expect(e1King()).toBe(pieceUrl('neo', 'w', 'k'));
  });
});
