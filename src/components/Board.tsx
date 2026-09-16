import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { Color, MoveIntent } from '../game/types';
import { boardOf, isPromotion, legalTargets, pieceAt, premoveTargets } from '../game/rules';
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
   * all — spectating, out of turn, or the game is over.
   */
  movable: Color | null;
  /** The player's army while waiting for their own seat's turn. */
  premovable?: Color | null;
  premove?: MoveIntent | null;
  onPremove?: (intent: MoveIntent) => void;
  onCancelPremove?: () => void;
  lastMove: { from: string; to: string } | null;
  /** Square of a king in check, painted red. */
  checkSquare: string | null;
  pieceSet: PieceSetId;
  /** After a checkmate or a flag fall: the losing king's square and the winner's. */
  ending?: Ending | null;
  /** Showing an earlier position from the move list, not the live one. */
  browsing?: boolean;
  /** Drawn over the board — the result card when the game is over. */
  overlay?: ReactNode;
  onMove: (intent: MoveIntent) => void;
}

export interface Ending {
  kind: 'checkmate' | 'timeout';
  loser: string;
  winner: string;
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

const PROMOTION_CHOICES = ['q', 'r', 'b', 'n'] as const;

export function Board({
  fen,
  orientation,
  movable,
  premovable = null,
  premove = null,
  onPremove,
  onCancelPremove,
  lastMove,
  checkSquare,
  pieceSet,
  ending = null,
  browsing = false,
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
  }, [fen, movable, premovable, orientation, browsing]);

  const interactiveColor = movable ?? premovable;
  const destinations = (square: string) => movable
    ? legalTargets(fen, square)
    : premovable ? premoveTargets(fen, square) : [];
  const targets = selected ? destinations(selected) : [];
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
      submit({ from, to });
    }
  }

  function submit(intent: MoveIntent) {
    if (movable) onMove(intent);
    else if (premovable) onPremove?.(intent);
    setPending(null);
    setSelected(null);
  }

  function cancelMove() {
    setDrag(null);
    setSelected(null);
    setPending(null);
    setDrawing(null);
    onCancelPremove?.();
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
    if (e.button === 2 && (drag || selected || pending || premove)) {
      e.preventDefault();
      cancelMove();
      return;
    }
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
    if (premove) onCancelPremove?.();
    if (!interactiveColor) return;

    if (selected && targets.includes(square)) {
      commit(selected, square);
      return;
    }

    // Pressing your own piece selects it and arms a drag; changing your mind
    // mid-move re-aims the selection rather than clearing it.
    const piece = pieceAt(fen, square);
    if (piece?.color !== interactiveColor) {
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
    // Pressing a second mouse button while holding the first emits pointermove,
    // not pointerdown. Check the buttons bitmask to catch that right-click too.
    if (drag && (e.buttons & 2) !== 0) {
      cancelMove();
      return;
    }
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
    if (e.button !== 0) {
      setSelected(null);
      return;
    }

    if (drag.started) {
      const to = squareAt(e);
      if (to && to !== drag.from && destinations(drag.from).includes(to)) {
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
    setSelected(null);
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
    <div
      className={`board-wrap ${browsing ? 'browsing' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        if (drag || selected || pending || premove) cancelMove();
      }}
    >
      <div
        ref={boardRef}
        className={`board board-${orientation} ${drag?.started ? 'dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
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
              premove && (premove.from === square || premove.to === square) && 'premove',
              checkSquare === square && 'check',
              ending?.loser === square && (ending.kind === 'checkmate' ? 'mated' : 'flagged'),
              ending?.winner === square && 'victor',
              interactiveColor && piece?.color === interactiveColor && 'grabbable',
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
                {ending?.loser === square &&
                  (ending.kind === 'checkmate' ? (
                    <span className="king-badge badge-mated" title="Checkmated">
                      #
                    </span>
                  ) : (
                    <span className="king-badge badge-flagged" title="Out of time">
                      <Hourglass />
                    </span>
                  ))}
                {ending?.winner === square && (
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
                  aria-label={pieceName(interactiveColor ?? 'w', type)}
                  onClick={() => submit({ ...pending, promotion: type })}
                >
                  <img src={pieceUrl(pieceSet, interactiveColor ?? 'w', type)} alt="" draggable={false} />
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

export function Hourglass() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6 2h12v2h-1v3.2a5 5 0 0 1-2.4 4.3L13.9 12l.7.5A5 5 0 0 1 17 16.8V20h1v2H6v-2h1v-3.2a5 5 0 0 1 2.4-4.3l.7-.5-.7-.5A5 5 0 0 1 7 7.2V4H6zm3 2v3.2c0 1 .5 1.9 1.3 2.5L12 11l1.7-1.3A3 3 0 0 0 15 7.2V4zm3 9-1.7 1.3A3 3 0 0 0 9 16.8V20h6v-3.2a3 3 0 0 0-1.3-2.5z"
      />
    </svg>
  );
}

function Crown() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3 18h18v2H3zM3 7l4.5 4L12 4l4.5 7L21 7l-2 9H5z" />
    </svg>
  );
}
