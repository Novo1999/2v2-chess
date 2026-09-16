import { useState } from 'react';
import type { GameState, MoveIntent, Slot } from './game/types';
import { TURN_ORDER_2, TURN_ORDER_4 } from './game/types';
import { applyMove, colorToMove, createGame, resign, slotToMove } from './game/rules';
import { GameView } from './components/GameView';

/**
 * Hot seat. One device, every seat, no network — Phase 1 of PLAN.md.
 *
 * It exists as more than a demo: it is the control. When a networked game
 * misbehaves, this is the same rules layer with the transport removed.
 */
export function LocalGame({ onExit }: { onExit?: () => void }) {
  const [seats, setSeats] = useState<readonly Slot[]>(TURN_ORDER_4);
  const [state, setState] = useState<GameState>(() => createGame(TURN_ORDER_4));
  const [autoFlip, setAutoFlip] = useState(true);
  const [rejected, setRejected] = useState<string | null>(null);

  function move(intent: MoveIntent) {
    const result = applyMove(state, intent, slotToMove(state));
    if (!result.ok) {
      setRejected(result.reason);
      return;
    }
    setRejected(null);
    setState(result.state);
  }

  function reset(order: readonly Slot[]) {
    setSeats(order);
    setState(createGame(order));
    setRejected(null);
  }

  return (
    <GameView
      state={state}
      controls={seats}
      orientation={autoFlip ? colorToMove(state) : 'w'}
      onMove={move}
      banner={
        rejected && (
          <p className="reject" role="alert">
            {rejected}
          </p>
        )
      }
      aside={
        <div className="rotation">
          <span className="label">Rotation</span>
          <code>{seats.join(' → ')}</code>
        </div>
      }
      actions={
        <>
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoFlip}
              onChange={(e) => setAutoFlip(e.target.checked)}
            />
            Flip board each turn
          </label>
          <button onClick={() => reset(seats)}>New game</button>
          <button
            onClick={() => reset(seats === TURN_ORDER_4 ? TURN_ORDER_2 : TURN_ORDER_4)}
          >
            Switch to {seats === TURN_ORDER_4 ? '2' : '4'} seats
          </button>
          <button
            className="danger"
            disabled={state.status !== 'active'}
            onClick={() => setState(resign(state, slotToMove(state)))}
          >
            {slotToMove(state)} resigns
          </button>
          {onExit && <button onClick={onExit}>Leave</button>}
        </>
      }
    />
  );
}
