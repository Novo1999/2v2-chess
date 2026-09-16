/**
 * Core domain types.
 *
 * The shape here is deliberately the shape of the eventual RTDB node (PLAN.md
 * "Revised schema"), minus the networked-only fields. Phase 1 runs entirely
 * locally, but it runs on the same state model, so Phase 3 is a transport
 * change rather than a rewrite.
 */

export type Slot = 'P1' | 'P2' | 'P3' | 'P4';
export type Color = 'w' | 'b';
export type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

/**
 * Slot-to-army mapping. P1 and P2 share white; P3 and P4 share black.
 * This is fixed, not configurable — `turnOrder` decides rotation, not sides.
 */
export const SLOT_COLOR: Record<Slot, Color> = {
  P1: 'w',
  P2: 'w',
  P3: 'b',
  P4: 'b',
};

export const ALL_SLOTS: readonly Slot[] = ['P1', 'P2', 'P3', 'P4'];

/** Two players: one seat per side. Four: teammates alternate within a side. */
export const TURN_ORDER_2: readonly Slot[] = ['P1', 'P3'];
export const TURN_ORDER_4: readonly Slot[] = ['P1', 'P3', 'P2', 'P4'];

/** One entry in the append-only log. Never mutated once written. */
export interface MoveRecord {
  san: string;
  from: string;
  to: string;
  by: Slot;
  fenAfter: string;
  /** Piece type captured by this move, or null. Feeds the derived tray. */
  captured: PieceSymbol | null;
  ts: number;
}

export type GameStatus =
  /** Seats are still being claimed; no move may be played yet. */
  | 'lobby'
  | 'active'
  | 'checkmate'
  | 'stalemate'
  | 'draw'
  | 'resigned'
  /** A team's shared clock ran out. */
  | 'timeout';

export type Result = '1-0' | '0-1' | '1/2-1/2';

export interface GameState {
  /** Cached position. Derivable from `moves`, stored for instant load. */
  fen: string;
  /** Monotonic. The RTDB rule `newData.turnIndex === data.turnIndex + 1` keys off this. */
  turnIndex: number;
  turnOrder: readonly Slot[];
  moves: readonly MoveRecord[];
  status: GameStatus;
  result: Result | null;
}

export interface MoveIntent {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}
