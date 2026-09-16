import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Color, GameState, MoveIntent, MoveRecord, Slot } from '../game/types';
import { SLOT_COLOR } from '../game/types';
import { colorToMove, isCheck, kingSquare, slotToMove } from '../game/rules';
import { capturedTray, toPgn } from '../game/derive';
import { Board } from './Board';
import { CapturedTray } from './CapturedTray';
import { MoveList } from './MoveList';
import { isMuted, playMoveSound, setMuted } from '../sound';

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
  /** Display names by seat. Seats without one show their slot label. */
  names?: Partial<Record<Slot, string>>;
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
  names = {},
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

  useMoveSounds(state.moves);

  return (
    <div className="game">
      <div className="game-main">
        {banner}
        <div className="side-strip">
          <SeatBadge
            slot={oppositeSeatShown(state, orientation)}
            state={state}
            you={you}
            names={names}
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
            names={names}
          />
          <CapturedTray tray={tray} side={orientation} />
        </div>
      </div>

      <aside className="panel">
        <Verdict state={state} yours={yours} inCheck={inCheck} names={names} />
        {aside}
        <MoveList moves={state.moves} />
        <div className="actions">
          <SoundToggle />
          {actions}
        </div>
        <pre className="pgn">{toPgn(state.moves, state.result)}</pre>
      </aside>
    </div>
  );
}

/**
 * A sound for each move that arrives, whoever played it — the mover hears it
 * the instant the local write lands, everyone else when the listener fires.
 * The first render is a game being loaded, not a move being played, so it is
 * silent; so is a move rolled back by a rejected write.
 */
function useMoveSounds(moves: readonly MoveRecord[]) {
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = moves.length;
    if (before === null || moves.length <= before) return;
    playMoveSound(moves[moves.length - 1]?.captured ? 'capture' : 'move');
  }, [moves]);
}

function SoundToggle() {
  const [muted, setMutedState] = useState(isMuted);
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={!muted}
        onChange={(e) => {
          setMuted(!e.target.checked);
          setMutedState(!e.target.checked);
        }}
      />
      Move sounds
    </label>
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
  names,
}: {
  slot: Slot | Color;
  state: GameState;
  you: Slot | null;
  names: Partial<Record<Slot, string>>;
}) {
  const isSeat = slot === 'P1' || slot === 'P2' || slot === 'P3' || slot === 'P4';
  const onTurn = isSeat && slot === slotToMove(state) && state.status === 'active';
  const army = isSeat ? SLOT_COLOR[slot] : (slot as Color);

  // Off-turn, a strip names the whole team: in consultation chess the army
  // belongs to both of them, not to whoever happened to move last.
  const teamNames = state.turnOrder
    .filter((seat) => SLOT_COLOR[seat] === army && names[seat])
    .map((seat) => names[seat])
    .join(' & ');
  const label = isSeat
    ? (names[slot] ?? slot)
    : teamNames || (army === 'w' ? 'White' : 'Black');

  return (
    <span className={`seat ${onTurn ? 'on-turn' : ''}`}>
      <span className={`pip pip-${army}`} />
      {label}
      {isSeat && names[slot] && <span className="slottag">{slot}</span>}
      {isSeat && slot === you && <span className="you">you</span>}
      {onTurn && <span className="tomove">to move</span>}
    </span>
  );
}

function Verdict({
  state,
  yours,
  inCheck,
  names,
}: {
  state: GameState;
  yours: boolean;
  inCheck: boolean;
  names: Partial<Record<Slot, string>>;
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
      <strong>{yours ? 'Your move' : `${names[toMove] ?? toMove} to move`}</strong>
      {inCheck && <span className="incheck">check</span>}
    </div>
  );
}
