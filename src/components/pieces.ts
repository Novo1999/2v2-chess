import type { Color, PieceSymbol } from '../game/types';

/**
 * Figurine glyphs. Shared by the board and the captured tray so a bishop is
 * the same shape in both places.
 */
export const GLYPH: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
