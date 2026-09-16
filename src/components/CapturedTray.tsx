import type { Color } from '../game/types';
import type { CapturedTray as Tray } from '../game/derive';
import { materialBalance } from '../game/derive';
import { pieceName, pieceUrl } from './pieces';
import type { PieceSetId } from '../appearance';

interface Props {
  tray: Tray;
  /** Which army's haul to show. Its pieces are the *opposing* colour. */
  side: Color;
  pieceSet: PieceSetId;
}

export function CapturedTray({ tray, side, pieceSet }: Props) {
  const taken = tray[side];
  const enemy: Color = side === 'w' ? 'b' : 'w';
  const balance = materialBalance(tray);
  const lead = side === 'w' ? balance : -balance;

  return (
    <div className="tray">
      <span className="tray-pieces">
        {taken.map((piece, i) => (
          <img
            key={i}
            className="tray-piece"
            src={pieceUrl(pieceSet, enemy, piece)}
            alt={pieceName(enemy, piece)}
            draggable={false}
          />
        ))}
      </span>
      {lead > 0 && <span className="tray-lead">+{lead}</span>}
    </div>
  );
}
