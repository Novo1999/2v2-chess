import type { Color, PieceSymbol } from '../game/types';

/** U+FE0E asks for text presentation, so no font swaps a pawn for an emoji. */
const TEXT = '︎';

/**
 * Figurine glyphs, shared by the board, the captured tray and the promotion
 * picker so a bishop is the same shape everywhere. Both armies deliberately use
 * the solid (black) code points; colour comes from CSS.
 */
const SOLID: Record<PieceSymbol, string> = {
  k: '♚' + TEXT,
  q: '♛' + TEXT,
  r: '♜' + TEXT,
  b: '♝' + TEXT,
  n: '♞' + TEXT,
  p: '♟' + TEXT,
};

export const GLYPH: Record<Color, Record<PieceSymbol, string>> = { w: SOLID, b: SOLID };
