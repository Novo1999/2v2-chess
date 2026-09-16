import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { Color, MoveIntent, PieceSymbol } from '../game/types';
import { boardOf, isPromotion, legalTargets, pieceAt } from '../game/rules';
import { pieceName, pieceUrl } from './pieces';
import type { PieceSetId } from '../appearance';
import {
  ArrowLayer,
  MARK_COLOR,
  NO_ANNOTATIONS,
  brushFor,
  toggleArrow,
  toggleMark,
  type Annotations,
  type Brush,
} from './Annotations';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

/** Movement below this is a wobbly click, not a drag. */
const DRAG_THRESHOLD_PX = 4;

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
  pieceSet: PieceSetId;
  /** After a checkmate: the mated king's square and the winning king's. */
  mate?: { loser: string; winner: string } | null;
  /** Drawn over the board — the result card when the game is over. */
  overlay?: ReactNode;
  onMove: (intent: MoveIntent) => void;
}

interface Drag {
  from: string;
  startX: number;
  startY: number;
  /** Pointer position relative to the board, once the drag has really begun. */
  x: number;
  y: number;
  started: boolean;
  /** Pressing an already-selected piece and releasing without moving deselects. */
  wasSelected: boolean;
}

interface Drawing {
  from: string;
  to: string;
  brush: Brush;
}

const PROMOTION_CHOICES: PieceSymbol[] = ['q', 'r', 'b', 'n'];

export function Board({
  fen,
  orientation,
  movable,
  lastMove,
  checkSquare,
  pieceSet,
  mate = null,
  overlay,
  onMove,
}: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [annotations, setAnnotations] = useState<Annotations>(NO_ANNOTATIONS);

  // A move by anyone invalidates a selection or a drag begun against the old
  // position. Annotations stay: they are the player's notes, and chess.com
  // keeps them until a left click too.
  useEffect(() => {
    setSelected(null);
    setPending(null);
    setDrag(null);
  }, [fen, movable]);

  const targets = selected ? legalTargets(fen, selected) : [];
  const rows = boardOf(fen);

  const files = orientation === 'w' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'w' ? RANKS : [...RANKS].reverse();

  /** Square centre in board units, for the arrow layer. */
  const locate = (square: string): [number, number] => [
    files.indexOf(square[0] as never) + 0.5,
    ranks.indexOf(square[1] as never) + 0.5,
  ];

  function relative(e: PointerEvent): { x: number; y: number; size: number } {
    const rect = boardRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, size: rect.width };
  }

  /** The square under the pointer, from coordinates — used once it has moved. */
  function squareAt(e: PointerEvent): string | null {
    const { x, y, size } = relative(e);
    if (!size || x < 0 || y < 0 || x >= size || y >= size) return null;
    const col = Math.floor((x / size) * 8);
    const row = Math.floor((y / size) * 8);
    return `${files[col]}${ranks[row]}`;
  }

  /**
   * The square that was pressed, from the event target. Preferred on press
   * because it needs no layout, and pointer capture later retargets every event
   * to the board, which is why moves and releases use coordinates instead.
   */
  function squareOf(e: PointerEvent): string | null {
    const el = (e.target as Element).closest?.('[data-square]');
    return el?.getAttribute('data-square') ?? squareAt(e);
  }

  function commit(from: string, to: string) {
    if (isPromotion(fen, from, to)) {
      setPending({ from, to });
    } else {
      onMove({ from, to });
      setSelected(null);
    }
  }

  function capture(e: PointerEvent) {
    const el = e.currentTarget as Element;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events have no live pointer to capture */
      }
    }
  }

  function onPointerDown(e: PointerEvent) {
    const square = squareOf(e);
    if (!square) return;

    if (e.button === 2) {
      e.preventDefault();
      capture(e);
      setDrawing({ from: square, to: square, brush: brushFor(e) });
      return;
    }
    if (e.button !== 0) return;

    // Any left click wipes the annotations, as on chess.com.
    setAnnotations(NO_ANNOTATIONS);
    if (!movable) return;

    if (selected && targets.includes(square)) {
      commit(selected, square);
      return;
    }

    // Pressing your own piece selects it and arms a drag; changing your mind
    // mid-move re-aims the selection rather than clearing it.
    const piece = pieceAt(fen, square);
    if (piece?.color !== movable) {
      setSelected(null);
      return;
    }
    capture(e);
    const { x, y } = relative(e);
    setDrag({
      from: square,
      startX: e.clientX,
      startY: e.clientY,
      x,
      y,
      started: false,
      wasSelected: selected === square,
    });
    setSelected(square);
  }

  function onPointerMove(e: PointerEvent) {
    if (drawing) {
      const to = squareAt(e);
      if (to && to !== drawing.to) setDrawing({ ...drawing, to });
      return;
    }
    if (!drag) return;
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (!drag.started && moved < DRAG_THRESHOLD_PX) return;
    const { x, y } = relative(e);
    setDrag({ ...drag, x, y, started: true });
  }

  function onPointerUp(e: PointerEvent) {
    if (drawing) {
      const { from, to, brush } = drawing;
      setDrawing(null);
      setAnnotations((current) =>
        from === to ? toggleMark(current, { square: from, brush }) : toggleArrow(current, { from, to, brush }),
      );
      return;
    }
    if (!drag) return;
    setDrag(null);

    if (drag.started) {
      const to = squareAt(e);
      if (to && to !== drag.from && legalTargets(fen, drag.from).includes(to)) {
        commit(drag.from, to);
      }
      // An illegal drop just snaps back, leaving the piece selected so its
      // legal squares stay on show.
      return;
    }
    if (drag.wasSelected) setSelected(null);
  }

  function onPointerCancel() {
    setDrag(null);
    setDrawing(null);
  }

  const dragOver = drag?.started && boardRef.current
    ? (() => {
        const size = boardRef.current.getBoundingClientRect().width;
        const col = Math.floor((drag.x / size) * 8);
        const row = Math.floor((drag.y / size) * 8);
        return col >= 0 && col < 8 && row >= 0 && row < 8 ? `${files[col]}${ranks[row]}` : null;
      })()
    : null;

  const liveArrows =
    drawing && drawing.from !== drawing.to
      ? [...annotations.arrows.filter((a) => !(a.from === drawing.from && a.to === drawing.to)), drawing]
      : annotations.arrows;

  const dragged = drag?.started ? pieceAt(fen, drag.from) : null;

  return (
    <div className="board-wrap">
      <div
        ref={boardRef}
        className={`board board-${orientation} ${drag?.started ? 'dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {ranks.map((rank) =>
          files.map((file) => {
            const square = `${file}${rank}`;
            const piece = rows[RANKS.indexOf(rank)]![FILES.indexOf(file)!];
            const isTarget = targets.includes(square);
            const mark = annotations.marks.find((m) => m.square === square);
            const classes = [
              'sq',
              (FILES.indexOf(file) + Number(rank)) % 2 === 0 ? 'dark' : 'light',
              selected === square && 'selected',
              isTarget && (piece ? 'capture' : 'target'),
              lastMove &&
                (lastMove.from === square || lastMove.to === square) &&
                'lastmove',
              checkSquare === square && 'check',
              mate?.loser === square && 'mated',
              mate?.winner === square && 'victor',
              movable && piece?.color === movable && 'grabbable',
              drag?.started && drag.from === square && 'drag-origin',
              dragOver === square && isTarget && 'drag-over',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={square}
                className={classes}
                data-square={square}
                style={grainOffset(file, rank)}
                role="gridcell"
                aria-label={square}
              >
                {mark && (
                  <span className="sq-mark" style={{ background: MARK_COLOR[mark.brush] }} />
                )}
                {piece && (
                  <img
                    className="piece"
                    src={pieceUrl(pieceSet, piece.color, piece.type)}
                    alt={pieceName(piece.color, piece.type)}
                    draggable={false}
                  />
                )}
                {mate?.loser === square && (
                  <span className="king-badge badge-mated" title="Checkmated">
                    #
                  </span>
                )}
                {mate?.winner === square && (
                  <span className="king-badge badge-victor" title="Winner">
                    <Crown />
                  </span>
                )}
                {file === files[0] && <span className="coord rank">{rank}</span>}
                {rank === ranks[7] && <span className="coord file">{file}</span>}
              </div>
            );
          }),
        )}
      </div>

      <ArrowLayer arrows={liveArrows} locate={locate} />

      {dragged && drag && (
        <img
          className="drag-piece"
          src={pieceUrl(pieceSet, dragged.color, dragged.type)}
          alt=""
          draggable={false}
          style={{ left: drag.x, top: drag.y }}
        />
      )}

      {overlay}

      {pending && (
        <div className="promo-backdrop" onClick={() => setPending(null)}>
          <div className="promo" onClick={(e) => e.stopPropagation()}>
            <p>Promote to</p>
            <div className="promo-row">
              {PROMOTION_CHOICES.map((type) => (
                <button
                  key={type}
                  aria-label={pieceName(movable ?? 'w', type)}
                  onClick={() => {
                    onMove({ ...pending, promotion: type as 'q' });
                    setPending(null);
                    setSelected(null);
                  }}
                >
                  <img src={pieceUrl(pieceSet, movable ?? 'w', type)} alt="" draggable={false} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Which patch of the wood-grain texture a square shows. Scrambled from the
 * square's identity, not its screen position, so neighbours never continue one
 * another's grain and flipping the board keeps each square's own look.
 */
function grainOffset(file: string, rank: string): Record<string, number> {
  const f = FILES.indexOf(file as never);
  const r = Number(rank) - 1;
  return { '--gx': (f * 3 + r) % 8, '--gy': (r * 5 + f * 2) % 8 };
}

function Crown() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3 18h18v2H3zM3 7l4.5 4L12 4l4.5 7L21 7l-2 9H5z" />
    </svg>
  );
}
