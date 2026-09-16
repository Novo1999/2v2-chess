import type { Color, PieceSymbol } from '../game/types';
import type { CapturedTray as Tray } from '../game/derive';
import { materialBalance } from '../game/derive';

const GLYPH: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

interface Props {
  tray: Tray;
  /** Which army's haul to show. Its pieces are the *opposing* colour. */
  side: Color;
}

export function CapturedTray({ tray, side }: Props) {
  const taken = tray[side];
  const enemy: Color = side === 'w' ? 'b' : 'w';
  const balance = materialBalance(tray);
  const lead = side === 'w' ? balance : -balance;

  return (
    <div className="tray">
      <span className="tray-pieces">
        {taken.map((piece, i) => (
          <span key={i} className={`glyph glyph-${enemy}`}>
            {GLYPH[enemy][piece]}
          </span>
        ))}
      </span>
      {lead > 0 && <span className="tray-lead">+{lead}</span>}
    </div>
  );
}
