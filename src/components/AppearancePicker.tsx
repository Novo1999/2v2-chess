import {
  BOARDS,
  PIECE_SETS,
  setBoard,
  setPieces,
  useAppearance,
  type BoardId,
  type PieceSetId,
} from '../appearance';
import { pieceUrl } from './pieces';
import { ChoiceGroup } from './controls';

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
        <ChoiceGroup<BoardId>
          label="Board"
          value={board}
          onChange={setBoard}
          options={BOARDS.map((option) => ({
            id: option.id,
            label: (
              <>
                <span
                  className={`board-preview board-theme-${option.id}`}
                  aria-hidden="true"
                >
                  <span className="tile light" style={tile(1, 3)} />
                  <span className="tile dark" style={tile(4, 6)} />
                  <span className="tile dark" style={tile(6, 2)} />
                  <span className="tile light" style={tile(3, 5)} />
                </span>
                <span className="choice-label">{option.label}</span>
              </>
            ),
          }))}
        />
      </div>

      <div className="field">
        <span className="label">Pieces</span>
        <ChoiceGroup<PieceSetId>
          label="Pieces"
          value={pieces}
          onChange={setPieces}
          options={PIECE_SETS.map((option) => ({
            id: option.id,
            label: (
              <>
                <span className={`pieces-preview board-theme-${board}`} aria-hidden="true">
                  <span className="tile light">
                    <img src={pieceUrl(option.id, 'w', 'n')} alt="" draggable={false} />
                  </span>
                  <span className="tile dark">
                    <img src={pieceUrl(option.id, 'b', 'n')} alt="" draggable={false} />
                  </span>
                </span>
                <span className="choice-label">{option.label}</span>
              </>
            ),
          }))}
        />
      </div>
    </div>
  );
}

/** Which square of the preview grid a tile sits on. */
function tile(gx: number, gy: number): React.CSSProperties {
  return { ['--gx' as string]: gx, ['--gy' as string]: gy };
}
