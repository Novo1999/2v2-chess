import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Color, GameState, MoveIntent, MoveRecord, Slot } from '../game/types';
import { SLOT_COLOR } from '../game/types';
import { colorToMove, isCheck, kingSquare, slotToMove } from '../game/rules';
import { capturedTray, toPgn } from '../game/derive';
import { Board } from './Board';
import { CapturedTray } from './CapturedTray';
import { MoveList } from './MoveList';
import { isMuted, playMoveSound, setMuted } from '../sound';
import { useAppearance } from '../appearance';
import { AppearancePicker } from './AppearancePicker';

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

  const mated = state.status === 'checkmate' ? colorToMove(state) : null;
  const mate = mated
    ? {
        loser: kingSquare(state.fen, mated) ?? '',
        winner: kingSquare(state.fen, flip(mated)) ?? '',
      }
    : null;

  const appearance = useAppearance();

  return (
    <div className={`game board-theme-${appearance.board}`}>
      <div className="game-main">
        {banner}
        <div className="side-strip">
          <SeatBadge
            slot={oppositeSeatShown(state, orientation)}
            state={state}
            you={you}
            names={names}
          />
          <CapturedTray tray={tray} side={flip(orientation)} pieceSet={appearance.pieces} />
        </div>

        <Board
          fen={state.fen}
          orientation={orientation}
          movable={yours ? SLOT_COLOR[toMove] : null}
          lastMove={last}
          checkSquare={checkSquare}
          pieceSet={appearance.pieces}
          mate={mate}
          overlay={<ResultCard state={state} you={you} names={names} />}
          onMove={onMove}
        />

        <div className="side-strip">
          <SeatBadge
            slot={nearSeatShown(state, orientation)}
            state={state}
            you={you}
            names={names}
          />
          <CapturedTray tray={tray} side={orientation} pieceSet={appearance.pieces} />
        </div>
      </div>

      <aside className="panel">
        <Verdict state={state} yours={yours} inCheck={inCheck} names={names} />
        <PlayerList state={state} you={you} names={names} />
        {aside}
        <MoveList moves={state.moves} />
        <div className="actions">
          <AppearancePicker compact />
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

/**
 * Every seat, in the order they move. The highlight walks down the list turn by
 * turn, which makes the rotation itself visible — in consultation chess "whose
 * move is it" means which of four people, not which of two colours.
 */
function PlayerList({
  state,
  you,
  names,
}: {
  state: GameState;
  you: Slot | null;
  names: Partial<Record<Slot, string>>;
}) {
  const toMove = state.status === 'active' ? slotToMove(state) : null;
  return (
    <ol className="players" aria-label="Players in turn order">
      {state.turnOrder.map((slot) => {
        const army = SLOT_COLOR[slot];
        return (
          <li
            key={slot}
            className={`player-row player-${army} ${slot === toMove ? 'to-move' : ''}`}
            aria-current={slot === toMove ? 'true' : undefined}
          >
            <span className={`pip pip-${army}`} />
            <span className="player-name">{names[slot] ?? slot}</span>
            {names[slot] && <span className="slottag">{slot}</span>}
            {slot === you && <span className="you">you</span>}
          </li>
        );
      })}
    </ol>
  );
}

const ENDINGS: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  draw: 'Draw',
  resigned: 'Resignation',
  timeout: 'Out of time',
};

/**
 * The end of the game, said loudly. It waits a beat before appearing so the
 * final move is seen landing first, and it can be put away to study the final
 * position — it comes back only when a game ends again.
 */
function ResultCard({
  state,
  you,
  names,
}: {
  state: GameState;
  you: Slot | null;
  names: Partial<Record<Slot, string>>;
}) {
  const over = state.status !== 'active' && state.status !== 'lobby';
  const endKey = `${state.status}:${state.moves.length}:${state.result}`;
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!over || !state.result || dismissed === endKey) return null;

  const winner: Color | null =
    state.result === '1-0' ? 'w' : state.result === '0-1' ? 'b' : null;
  const team = (army: Color) =>
    state.turnOrder
      .filter((seat) => SLOT_COLOR[seat] === army)
      .map((seat) => names[seat])
      .filter(Boolean)
      .join(' & ') || (army === 'w' ? 'White' : 'Black');

  const last = state.moves[state.moves.length - 1];
  const loser = winner ? flip(winner) : null;
  const detail =
    state.status === 'checkmate' && last
      ? `${last.san} by ${names[last.by] ?? last.by}`
      : state.status === 'resigned' && loser
        ? `${team(loser)} resigned`
        : state.status === 'timeout' && loser
          ? `${team(loser)} ran out of time`
          : state.status === 'stalemate'
            ? 'No legal moves, and no check'
            : 'The game is drawn';

  const personal =
    you === null ? null : winner === null ? 'draw' : SLOT_COLOR[you] === winner ? 'won' : 'lost';

  return (
    <div className={`result-backdrop result-${state.status}`} role="dialog" aria-label="Game over">
      <div className={`result-card ${personal ? `personal-${personal}` : ''}`}>
        {personal && (
          <div className="result-personal">
            {personal === 'won' ? 'You won' : personal === 'lost' ? 'You lost' : 'Draw'}
          </div>
        )}
        <div className="result-title">{ENDINGS[state.status] ?? 'Game over'}</div>
        <div className="result-winner">
          {winner ? (
            <>
              <span className={`pip pip-${winner}`} />
              {team(winner)} {team(winner).includes('&') ? 'win' : 'wins'}
            </>
          ) : (
            'Nobody wins'
          )}
        </div>
        <div className="result-detail">{detail}</div>
        <div className="result-score">{state.result === '1/2-1/2' ? '½-½' : state.result}</div>
        <button onClick={() => setDismissed(endKey)}>View board</button>
      </div>
    </div>
  );
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
