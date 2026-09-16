import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Color, GameState, MoveIntent, MoveRecord, Slot } from '../game/types';
import { SLOT_COLOR } from '../game/types';
import { START_FEN, colorToMove, isCheck, kingSquare, slotToMove } from '../game/rules';
import { capturedTray, toPgn } from '../game/derive';
import { Board, Hourglass, type Ending } from './Board';
import { CapturedTray } from './CapturedTray';
import { HistoryNav, MoveList } from './MoveList';
import { PresenceIcon } from './Presence';
import { isMuted, playMoveSound, setMuted, type MoveSound } from '../sound';
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
  /**
   * Whether each seat's player is connected, for networked games. Left out in
   * hot seat, where everyone is at the same keyboard by definition.
   */
  presence?: Partial<Record<Slot, boolean>>;
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
  presence,
  orientation,
  onMove,
  aside,
  banner,
  actions,
}: Props) {
  const toMove = slotToMove(state);
  const active = state.status === 'active';
  const yours = active && controls.includes(toMove);
  const inCheck = isCheck(state.fen);

  useMoveSounds(state.moves);
  const { shown, browsing, show } = useHistory(state.moves, yours);

  // Everything drawn on and around the board follows the position being shown;
  // the panel — whose turn, the clocks, the result — stays on the live game.
  const moves = state.moves.slice(0, shown);
  const fen = browsing ? (moves[shown - 1]?.fenAfter ?? START_FEN) : state.fen;
  const tray = capturedTray(moves);
  const last = moves[moves.length - 1] ?? null;
  const checkSquare = isCheck(fen) ? kingSquare(fen, fen.split(' ')[1] as Color) : null;
  const ending = browsing ? null : endingOf(state);

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
            presence={presence}
          />
          <CapturedTray tray={tray} side={flip(orientation)} pieceSet={appearance.pieces} />
        </div>

        <Board
          fen={fen}
          orientation={orientation}
          movable={yours && !browsing ? SLOT_COLOR[toMove] : null}
          lastMove={last}
          checkSquare={checkSquare}
          pieceSet={appearance.pieces}
          ending={ending}
          browsing={browsing}
          overlay={<ResultCard state={state} you={you} names={names} hidden={browsing} />}
          onMove={onMove}
        />

        <div className="side-strip">
          <SeatBadge
            slot={nearSeatShown(state, orientation)}
            state={state}
            you={you}
            names={names}
            presence={presence}
          />
          <CapturedTray tray={tray} side={orientation} pieceSet={appearance.pieces} />
        </div>
      </div>

      <aside className="panel">
        <Verdict state={state} yours={yours} inCheck={inCheck} names={names} />
        <PlayerList state={state} you={you} names={names} presence={presence} />
        {aside}
        <div className="history">
          <MoveList moves={state.moves} shown={shown} onShow={show} />
          <HistoryNav total={state.moves.length} shown={shown} onShow={show} />
        </div>
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
    playMoveSound(soundFor(moves[moves.length - 1]!));
  }, [moves]);
}

/** A check outranks a capture: it is the one the players need to notice. */
function soundFor(move: MoveRecord): MoveSound {
  if (/[+#]/.test(move.san)) return 'check';
  return move.captured ? 'capture' : 'move';
}

/**
 * Stepping back through the game. `shown` is how many moves in the board is,
 * and the full length means live. The cursor is only held while it points into
 * the past, so stepping forward onto the last move rejoins the live game and
 * later moves keep arriving on the board.
 */
function useHistory(moves: readonly MoveRecord[], yours: boolean) {
  const total = moves.length;
  const [cursor, setCursor] = useState<number | null>(null);
  const shown = cursor === null ? total : Math.min(cursor, total);
  const browsing = shown < total;

  // A new game starts live, and so does your turn: the shared clock is running,
  // and a board you cannot move on is no place to discover that.
  const before = useRef(total);
  useEffect(() => {
    const previous = before.current;
    before.current = total;
    if (total < previous || (total > previous && yours)) setCursor(null);
  }, [total, yours]);

  const show = (ply: number) => {
    const next = Math.max(0, Math.min(ply, total));
    if (next === shown) return;
    setCursor(next >= total ? null : next);
    const move = moves[next - 1];
    if (move) playMoveSound(soundFor(move));
  };

  // The arrow keys step too, as on every chess site — unless someone is typing.
  const step = useRef((delta: number) => show(shown + delta));
  step.current = (delta: number) => show(shown + delta);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as Element | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      step.current(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { shown, browsing, show };
}

/** The kings to mark once the game is decided on the board or on the clock. */
function endingOf(state: GameState): Ending | null {
  let loser: Color;
  if (state.status === 'checkmate') {
    loser = colorToMove(state);
  } else if (state.status === 'timeout' && (state.result === '1-0' || state.result === '0-1')) {
    loser = state.result === '1-0' ? 'b' : 'w';
  } else {
    return null;
  }
  return {
    kind: state.status,
    loser: kingSquare(state.fen, loser) ?? '',
    winner: kingSquare(state.fen, flip(loser)) ?? '',
  };
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
  presence,
}: {
  state: GameState;
  you: Slot | null;
  names: Partial<Record<Slot, string>>;
  presence?: Partial<Record<Slot, boolean>>;
}) {
  const toMove = state.status === 'active' ? slotToMove(state) : null;
  return (
    <ol className="players" aria-label="Players in turn order">
      {state.turnOrder.map((slot) => {
        const army = SLOT_COLOR[slot];
        const connected = presence?.[slot];
        return (
          <li
            key={slot}
            className={`player-row player-${army} ${slot === toMove ? 'to-move' : ''} ${connected === false ? 'offline' : ''}`}
            aria-current={slot === toMove ? 'true' : undefined}
          >
            <span className={`pip pip-${army}`} />
            <span className="player-name">{names[slot] ?? slot}</span>
            {names[slot] && <span className="slottag">{slot}</span>}
            {slot === you && <span className="you">you</span>}
            {connected !== undefined && <PresenceIcon connected={connected} />}
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
  hidden,
}: {
  state: GameState;
  you: Slot | null;
  names: Partial<Record<Slot, string>>;
  /** Kept mounted while browsing, so a card put away stays put away. */
  hidden: boolean;
}) {
  const over = state.status !== 'active' && state.status !== 'lobby';
  const endKey = `${state.status}:${state.moves.length}:${state.result}`;
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (hidden || !over || !state.result || dismissed === endKey) return null;

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
          ? `${team(loser)} ran out of time on ${names[slotToMove(state)] ?? slotToMove(state)}'s move`
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
        {state.status === 'timeout' && (
          <div className="result-icon">
            <Hourglass />
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
  presence,
}: {
  slot: Slot | Color;
  state: GameState;
  you: Slot | null;
  names: Partial<Record<Slot, string>>;
  presence?: Partial<Record<Slot, boolean>>;
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
      {isSeat && presence?.[slot] === false && <PresenceIcon connected={false} />}
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
      timeout: 'Out of time',
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
