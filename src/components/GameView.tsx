import type { ReactNode } from 'react';
import type { Color, GameState, MoveIntent, Slot } from '../game/types';
import { SLOT_COLOR } from '../game/types';
import { colorToMove, isCheck, kingSquare, slotToMove } from '../game/rules';
import { capturedTray, toPgn } from '../game/derive';
import { Board } from './Board';
import { CapturedTray } from './CapturedTray';
import { MoveList } from './MoveList';

interface Props {
  state: GameState;
  /**
   * The seats this client may play. Hot-seat passes every seat; a networked
   * client passes its one seat; a spectator passes none. One code path covers
   * all three, which is why Phase 3 is a transport change and not a rewrite.
   */
  controls: readonly Slot[];
  /** The seat this client occupies, for the "you" badge. Null when spectating. */
  you?: Slot | null;
  orientation: Color;
  onMove: (intent: MoveIntent) => void;
  /** Transport-specific panels: clocks, seats, connection, offers. */
  aside?: ReactNode;
  banner?: ReactNode;
  actions?: ReactNode;
}

export function GameView({
  state,
  controls,
  you = null,
  orientation,
  onMove,
  aside,
  banner,
  actions,
}: Props) {
  const toMove = slotToMove(state);
  const active = state.status === 'active';
  const yours = active && controls.includes(toMove);
  const tray = capturedTray(state.moves);
  const last = state.moves[state.moves.length - 1] ?? null;

  const inCheck = isCheck(state.fen);
  const checkSquare = inCheck ? kingSquare(state.fen, colorToMove(state)) : null;

  return (
    <div className="game">
      <div className="game-main">
        {banner}
        <div className="side-strip">
          <SeatBadge
            slot={oppositeSeatShown(state, orientation)}
            state={state}
            you={you}
          />
          <CapturedTray tray={tray} side={flip(orientation)} />
        </div>

        <Board
          fen={state.fen}
          orientation={orientation}
          movable={yours ? SLOT_COLOR[toMove] : null}
          lastMove={last}
          checkSquare={checkSquare}
          onMove={onMove}
        />

        <div className="side-strip">
          <SeatBadge
            slot={nearSeatShown(state, orientation)}
            state={state}
            you={you}
          />
          <CapturedTray tray={tray} side={orientation} />
        </div>
      </div>

      <aside className="panel">
        <Verdict state={state} yours={yours} inCheck={inCheck} />
        {aside}
        <MoveList moves={state.moves} />
        {actions && <div className="actions">{actions}</div>}
        <pre className="pgn">{toPgn(state.moves, state.result)}</pre>
      </aside>
    </div>
  );
}

function flip(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

/** The seat to move, if it belongs to the far army; otherwise that army's name. */
function oppositeSeatShown(state: GameState, orientation: Color): Slot | Color {
  const toMove = slotToMove(state);
  return SLOT_COLOR[toMove] === flip(orientation) ? toMove : flip(orientation);
}

function nearSeatShown(state: GameState, orientation: Color): Slot | Color {
  const toMove = slotToMove(state);
  return SLOT_COLOR[toMove] === orientation ? toMove : orientation;
}

function SeatBadge({
  slot,
  state,
  you,
}: {
  slot: Slot | Color;
  state: GameState;
  you: Slot | null;
}) {
  const isSeat = slot === 'P1' || slot === 'P2' || slot === 'P3' || slot === 'P4';
  const onTurn = isSeat && slot === slotToMove(state) && state.status === 'active';
  const army = isSeat ? SLOT_COLOR[slot] : (slot as Color);

  return (
    <span className={`seat ${onTurn ? 'on-turn' : ''}`}>
      <span className={`pip pip-${army}`} />
      {isSeat ? slot : army === 'w' ? 'White' : 'Black'}
      {isSeat && slot === you && <span className="you">you</span>}
      {onTurn && <span className="tomove">to move</span>}
    </span>
  );
}

function Verdict({
  state,
  yours,
  inCheck,
}: {
  state: GameState;
  yours: boolean;
  inCheck: boolean;
}) {
  if (state.status !== 'active') {
    const label: Record<string, string> = {
      checkmate: 'Checkmate',
      stalemate: 'Stalemate',
      draw: 'Draw',
      resigned: 'Resignation',
      timeout: 'Flag fell',
      lobby: 'Not started',
    };
    return (
      <div className="verdict over">
        <strong>{label[state.status] ?? 'Game over'}</strong>
        <span>{state.result}</span>
      </div>
    );
  }

  const toMove = slotToMove(state);
  return (
    <div className={`verdict ${yours ? 'yours' : ''}`}>
      <strong>{yours ? 'Your move' : `${toMove} to move`}</strong>
      {inCheck && <span className="incheck">check</span>}
    </div>
  );
}
