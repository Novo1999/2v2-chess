/**
 * Right-click annotations: square highlights and arrows, drawn the way the big
 * chess sites do it. They are private to the player drawing them — nothing here
 * touches the network. Sharing them with a teammate would quietly be in-app
 * chat, which PLAN.md decision #4 chose not to build.
 */

/** Held modifier picks the colour, as on chess.com. */
export type Brush = 'primary' | 'green' | 'blue' | 'yellow';

export interface Arrow {
  from: string;
  to: string;
  brush: Brush;
}

export interface Mark {
  square: string;
  brush: Brush;
}

export interface Annotations {
  arrows: Arrow[];
  marks: Mark[];
}

export const NO_ANNOTATIONS: Annotations = { arrows: [], marks: [] };

const ARROW_COLOR: Record<Brush, string> = {
  primary: 'rgb(255, 170, 0)',
  green: 'rgb(159, 207, 63)',
  blue: 'rgb(72, 193, 249)',
  yellow: 'rgb(255, 214, 10)',
};

export const MARK_COLOR: Record<Brush, string> = {
  primary: 'rgba(235, 97, 80, 0.8)',
  green: 'rgba(172, 206, 89, 0.8)',
  blue: 'rgba(82, 176, 220, 0.8)',
  yellow: 'rgba(245, 213, 66, 0.8)',
};

export function brushFor(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): Brush {
  if (event.shiftKey) return 'green';
  if (event.ctrlKey || event.metaKey) return 'blue';
  if (event.altKey) return 'yellow';
  return 'primary';
}

/**
 * Drawing the same thing again removes it; drawing it in another colour
 * recolours it. That makes every annotation its own undo.
 */
export function toggleArrow(current: Annotations, arrow: Arrow): Annotations {
  const existing = current.arrows.find((a) => a.from === arrow.from && a.to === arrow.to);
  const others = current.arrows.filter((a) => a !== existing);
  const arrows = existing?.brush === arrow.brush ? others : [...others, arrow];
  return { ...current, arrows };
}

export function toggleMark(current: Annotations, mark: Mark): Annotations {
  const existing = current.marks.find((m) => m.square === mark.square);
  const others = current.marks.filter((m) => m !== existing);
  const marks = existing?.brush === mark.brush ? others : [...others, mark];
  return { ...current, marks };
}

type Point = [number, number];

/** Square centre in board units (0..8), for the orientation being drawn. */
export type Locate = (square: string) => Point;

const WIDTH = 0.2;
const HEAD_LENGTH = 0.46;
const HEAD_HALF_WIDTH = 0.3;
/** Leave the origin piece readable: start a little way out from its centre. */
const START_OFFSET = 0.32;
/** The tip stops just short of the destination centre. */
const TIP_INSET = 0.12;

function unit(from: Point, to: Point): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

function along(p: Point, dir: Point, distance: number): Point {
  return [p[0] + dir[0] * distance, p[1] + dir[1] * distance];
}

/**
 * The shaft as a polyline plus a triangular head. A knight's move is drawn as an
 * L — long leg first — because a straight line through the middle of two
 * squares does not look like anything a knight can do.
 */
export function arrowGeometry(start: Point, end: Point): { shaft: Point[]; head: Point[] } {
  const dx = Math.abs(end[0] - start[0]);
  const dy = Math.abs(end[1] - start[1]);
  const knight = (dx === 1 && dy === 2) || (dx === 2 && dy === 1);

  const joints: Point[] = knight
    ? [start, dy > dx ? [start[0], end[1]] : [end[0], start[1]], end]
    : [start, end];

  const firstDir = unit(joints[0]!, joints[1]!);
  const lastDir = unit(joints[joints.length - 2]!, end);
  const tip = along(end, lastDir, -TIP_INSET);
  const base = along(tip, lastDir, -HEAD_LENGTH);
  const perp: Point = [-lastDir[1], lastDir[0]];

  const shaft = [along(start, firstDir, START_OFFSET), ...joints.slice(1, -1), base];
  const head = [
    tip,
    along(base, perp, HEAD_HALF_WIDTH),
    along(base, perp, -HEAD_HALF_WIDTH),
  ];
  return { shaft, head };
}

const points = (ps: Point[]) => ps.map((p) => `${p[0]},${p[1]}`).join(' ');

export function ArrowLayer({
  arrows,
  locate,
}: {
  arrows: Arrow[];
  locate: Locate;
}) {
  if (arrows.length === 0) return null;
  return (
    <svg className="annotations" viewBox="0 0 8 8" aria-hidden="true">
      {arrows.map((arrow) => {
        const { shaft, head } = arrowGeometry(locate(arrow.from), locate(arrow.to));
        const color = ARROW_COLOR[arrow.brush];
        return (
          // Opacity on the group, not the parts, so the shaft and head blend as
          // one shape instead of darkening where they overlap.
          <g key={`${arrow.from}${arrow.to}`} opacity={0.8} className="arrow">
            <polyline
              points={points(shaft)}
              fill="none"
              stroke={color}
              strokeWidth={WIDTH}
              strokeLinejoin="round"
            />
            <polygon points={points(head)} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}
