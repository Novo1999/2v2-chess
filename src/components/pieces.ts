import type { Color, PieceSymbol } from '../game/types';

/**
 * Piece artwork: the Chessnut set by Alexis Luengas, Apache 2.0 — see
 * src/assets/pieces/chessnut/README.md. Shared by the board, the captured tray
 * and the promotion picker so a bishop is the same drawing everywhere.
 */
const files = import.meta.glob<string>('../assets/pieces/chessnut/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

function file(name: string): string {
  const url = files[`../assets/pieces/chessnut/${name}.svg`];
  if (!url) throw new Error(`missing piece artwork: ${name}.svg`);
  return url;
}

const TYPES: PieceSymbol[] = ['k', 'q', 'r', 'b', 'n', 'p'];

export const PIECE_IMG: Record<Color, Record<PieceSymbol, string>> = {
  w: Object.fromEntries(TYPES.map((t) => [t, file(`w${t.toUpperCase()}`)])) as Record<PieceSymbol, string>,
  b: Object.fromEntries(TYPES.map((t) => [t, file(`b${t.toUpperCase()}`)])) as Record<PieceSymbol, string>,
};

const NAMES: Record<PieceSymbol, string> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn',
};

export function pieceName(color: Color, type: PieceSymbol): string {
  return `${color === 'w' ? 'white' : 'black'} ${NAMES[type]}`;
}
