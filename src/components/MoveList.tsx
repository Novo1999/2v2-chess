import type { MoveRecord } from '../game/types';
import { movePairs } from '../game/derive';

interface Props {
  moves: readonly MoveRecord[];
}

/**
 * The move list is a view of the log, not a copy of it. Each half-move shows
 * the seat that played it — in consultation chess "who moved" is the
 * interesting column, since the army alone no longer identifies the player.
 */
export function MoveList({ moves }: Props) {
  if (moves.length === 0) {
    return <p className="empty">No moves yet.</p>;
  }

  return (
    <ol className="movelist">
      {movePairs(moves).map((pair) => (
        <li key={pair.number}>
          <span className="movenum">{pair.number}.</span>
          <Half move={pair.white} />
          <Half move={pair.black} />
        </li>
      ))}
    </ol>
  );
}

function Half({ move }: { move: MoveRecord | null }) {
  if (!move) return <span className="half" />;
  return (
    <span className="half">
      {move.san}
      <span className="by">{move.by}</span>
    </span>
  );
}
