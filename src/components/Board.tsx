import { useEffect, useState } from 'react';
import type { Color, MoveIntent, PieceSymbol } from '../game/types';
import { boardOf, isPromotion, legalTargets, pieceAt } from '../game/rules';
import { GLYPH } from './pieces';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

interface Props {
  fen: string;
  /** Which way up to draw the board. */
  orientation: Color;
  /**
   * The army this client may move right now, or null when it may not move at
   * all — spectating, out of turn, or the game is over. The board is otherwise
   * identical in every case, so this single prop is the entire interaction gate.
   */
  movable: Color | null;
  lastMove: { from: string; to: string } | null;
  /** Square of a king in check, painted red. */
  checkSquare: string | null;
  onMove: (intent: MoveIntent) => void;
}

const PROMOTION_CHOICES: PieceSymbol[] = ['q', 'r', 'b', 'n'];

export function Board({
  fen,
  orientation,
  movable,
  lastMove,
  checkSquare,
  onMove,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: string; to: string } | null>(
    null,
  );

  // A move by anyone invalidates a selection made against the old position.
  useEffect(() => {
    setSelected(null);
    setPending(null);
  }, [fen, movable]);

  const targets = selected ? legalTargets(fen, selected) : [];
  const rows = boardOf(fen);

  function clickSquare(square: string) {
    if (!movable) return;

    if (selected && targets.includes(square)) {
      if (isPromotion(fen, selected, square)) {
        setPending({ from: selected, to: square });
      } else {
        onMove({ from: selected, to: square });
        setSelected(null);
      }
      return;
    }

    // Clicking your own piece re-aims the selection rather than clearing it,
    // which is what people expect when they change their mind mid-move.
    const piece = pieceAt(fen, square);
    setSelected(piece && piece.color === movable ? square : null);
  }

  const files = orientation === 'w' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'w' ? RANKS : [...RANKS].reverse();

  return (
    <div className="board-wrap">
      <div className={`board board-${orientation}`}>
        {ranks.map((rank) =>
          files.map((file) => {
            const square = `${file}${rank}`;
            const piece = rows[RANKS.indexOf(rank)]![FILES.indexOf(file)!];
            const isTarget = targets.includes(square);
            const classes = [
              'sq',
              (FILES.indexOf(file) + Number(rank)) % 2 === 0 ? 'dark' : 'light',
              selected === square && 'selected',
              isTarget && (piece ? 'capture' : 'target'),
              lastMove &&
                (lastMove.from === square || lastMove.to === square) &&
                'lastmove',
              checkSquare === square && 'check',
              movable && piece?.color === movable && 'grabbable',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={square}
                className={classes}
                onClick={() => clickSquare(square)}
                role="gridcell"
                aria-label={square}
              >
                {piece && (
                  <span className={`glyph glyph-${piece.color}`}>
                    {GLYPH[piece.color][piece.type]}
                  </span>
                )}
                {file === files[0] && <span className="coord rank">{rank}</span>}
                {rank === ranks[7] && <span className="coord file">{file}</span>}
              </div>
            );
          }),
        )}
      </div>

      {pending && (
        <div className="promo-backdrop" onClick={() => setPending(null)}>
          <div className="promo" onClick={(e) => e.stopPropagation()}>
            <p>Promote to</p>
            <div className="promo-row">
              {PROMOTION_CHOICES.map((type) => (
                <button
                  key={type}
                  className={`glyph glyph-${movable ?? 'w'}`}
                  onClick={() => {
                    onMove({ ...pending, promotion: type as 'q' });
                    setPending(null);
                    setSelected(null);
                  }}
                >
                  {GLYPH[movable ?? 'w'][type]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
