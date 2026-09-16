import {
  BOARDS,
  PIECE_SETS,
  setBoard,
  setPieces,
  useAppearance,
} from '../appearance';
import { pieceUrl } from './pieces';

/**
 * Board and piece choices, with a preview of each. The same control sits under
 * "Play online" on the home screen and beside the board during a game.
 */
export function AppearancePicker({ compact = false }: { compact?: boolean }) {
  const { board, pieces } = useAppearance();

  return (
    <div className={`appearance ${compact ? 'compact' : ''}`}>
      <div className="field">
        <span className="label">Board</span>
        <div className="choices" role="radiogroup" aria-label="Board">
          {BOARDS.map((option) => (
            <button
              key={option.id}
              role="radio"
              aria-checked={board === option.id}
              className={`choice ${board === option.id ? 'on' : ''}`}
              onClick={() => setBoard(option.id)}
            >
              <span className={`board-preview board-theme-${option.id}`} aria-hidden="true">
                <span className="tile light" style={{ ['--gx' as string]: 1, ['--gy' as string]: 3 }} />
                <span className="tile dark" style={{ ['--gx' as string]: 4, ['--gy' as string]: 6 }} />
                <span className="tile dark" style={{ ['--gx' as string]: 6, ['--gy' as string]: 2 }} />
                <span className="tile light" style={{ ['--gx' as string]: 3, ['--gy' as string]: 5 }} />
              </span>
              <span className="choice-label">{option.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">Pieces</span>
        <div className="choices" role="radiogroup" aria-label="Pieces">
          {PIECE_SETS.map((option) => (
            <button
              key={option.id}
              role="radio"
              aria-checked={pieces === option.id}
              className={`choice ${pieces === option.id ? 'on' : ''}`}
              onClick={() => setPieces(option.id)}
            >
              <span className={`pieces-preview board-theme-${board}`} aria-hidden="true">
                <span className="tile light">
                  <img src={pieceUrl(option.id, 'w', 'n')} alt="" draggable={false} />
                </span>
                <span className="tile dark">
                  <img src={pieceUrl(option.id, 'b', 'n')} alt="" draggable={false} />
                </span>
              </span>
              <span className="choice-label">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
