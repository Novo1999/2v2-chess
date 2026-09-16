import type { Color, PieceSymbol } from '../game/types';
import type { PieceSetId } from '../appearance';

/**
 * Piece artwork, one folder per set, each with its own license and credit:
 *
 *   classic  src/assets/pieces/cburnett  Colin M.L. Burnett, BSD
 *   neo      src/assets/pieces/chessnut  Alexis Luengas, Apache 2.0
 *   wood     src/assets/pieces/wood      generated from cburnett, BSD
 */
type Files = Record<string, string>;

// import.meta.glob needs a literal pattern and a literal options object in
// every call, hence three spelled-out calls rather than a loop.
const FOLDERS: Record<PieceSetId, { dir: string; files: Files }> = {
  classic: {
    dir: 'cburnett',
    files: import.meta.glob<string>('../assets/pieces/cburnett/*.svg', { eager: true, query: '?url', import: 'default' }),
  },
  neo: {
    dir: 'chessnut',
    files: import.meta.glob<string>('../assets/pieces/chessnut/*.svg', { eager: true, query: '?url', import: 'default' }),
  },
  wood: {
    dir: 'wood',
    files: import.meta.glob<string>('../assets/pieces/wood/*.svg', { eager: true, query: '?url', import: 'default' }),
  },
};

export function pieceUrl(set: PieceSetId, color: Color, type: PieceSymbol): string {
  const { dir, files } = FOLDERS[set];
  const url = files[`../assets/pieces/${dir}/${color}${type.toUpperCase()}.svg`];
  if (!url) throw new Error(`missing piece artwork: ${dir}/${color}${type.toUpperCase()}.svg`);
  return url;
}

const NAMES: Record<PieceSymbol, string> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};

export function pieceName(color: Color, type: PieceSymbol): string {
  return `${color === 'w' ? 'white' : 'black'} ${NAMES[type]}`;
}
