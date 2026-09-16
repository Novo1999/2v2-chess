import { useEffect, useRef } from 'react';
import type { MoveRecord } from '../game/types';
import { movePairs } from '../game/derive';

interface Props {
  moves: readonly MoveRecord[];
  /** How many moves into the game the board is showing. */
  shown: number;
  onShow: (ply: number) => void;
}

/**
 * The move list is a view of the log, not a copy of it. Each half-move shows
 * the seat that played it — in consultation chess "who moved" is the
 * interesting column, since the army alone no longer identifies the player.
 *
 * Every move is also a way back to the position it made.
 */
export function MoveList({ moves, shown, onShow }: Props) {
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the move on the board in sight as the list grows or is stepped through.
  useEffect(() => {
    const current = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    const list = listRef.current;
    if (!current || !list) return;
    const top = current.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + current.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + current.offsetHeight - list.clientHeight;
    }
  }, [shown, moves.length]);

  if (moves.length === 0) {
    return <p className="empty">No moves yet.</p>;
  }

  const plyOf = new Map(moves.map((move, i) => [move, i + 1]));
  const half = (move: MoveRecord | null) => {
    if (!move) return <span className="half" />;
    const ply = plyOf.get(move)!;
    return (
      <button
        type="button"
        className="half"
        aria-current={ply === shown ? 'true' : undefined}
        onClick={() => onShow(ply)}
      >
        {move.san}
        <span className="by">{move.by}</span>
      </button>
    );
  };

  return (
    <ol className="movelist" ref={listRef}>
      {movePairs(moves).map((pair) => (
        <li key={pair.number}>
          <span className="movenum">{pair.number}.</span>
          {half(pair.white)}
          {half(pair.black)}
        </li>
      ))}
    </ol>
  );
}

/** First, previous, next, latest — and the arrow keys do the same. */
export function HistoryNav({
  total,
  shown,
  onShow,
}: {
  total: number;
  shown: number;
  onShow: (ply: number) => void;
}) {
  const live = shown === total;
  return (
    <div className="history-nav">
      <button type="button" aria-label="First move" disabled={shown === 0} onClick={() => onShow(0)}>
        <NavIcon d="M6 5h2v14H6zM18 5v14L9 12z" />
      </button>
      <button type="button" aria-label="Previous move" disabled={shown === 0} onClick={() => onShow(shown - 1)}>
        <NavIcon d="M16 5v14L6 12z" />
      </button>
      <button type="button" aria-label="Next move" disabled={live} onClick={() => onShow(shown + 1)}>
        <NavIcon d="M8 5v14l10-7z" />
      </button>
      <button
        type="button"
        aria-label="Latest move"
        className={live ? '' : 'back-to-live'}
        disabled={live}
        onClick={() => onShow(total)}
      >
        <NavIcon d="M6 5v14l9-7zM16 5h2v14h-2z" />
      </button>
    </div>
  );
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d={d} />
    </svg>
  );
}
