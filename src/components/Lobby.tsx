import type { Slot } from '../game/types';
import { SLOT_COLOR } from '../game/types';
import type { NetGame } from '../net/schema';
import { allSeatsFilled, seatsOf } from '../net/schema';

interface Props {
  gameId: string;
  game: NetGame;
  mySlot: Slot | null;
  busy: boolean;
  onClaim: (slot: Slot) => void;
  onStart: () => void;
  onLeave: () => void;
}

/**
 * Seats are chosen, not handed out (decision #9). Four friends in a voice call
 * settle who is on whose team by talking about it, which is the one mechanism
 * guaranteed to be available to them.
 */
export function Lobby({ gameId, game, mySlot, busy, onClaim, onStart, onLeave }: Props) {
  const seats = seatsOf(game);
  const ready = allSeatsFilled(game);

  return (
    <div className="lobby">
      <div className="roomcode">
        <span className="label">Room code</span>
        <code>{gameId}</code>
        <button onClick={() => void navigator.clipboard?.writeText(gameId)}>
          Copy
        </button>
      </div>

      <div className="teams">
        {(['w', 'b'] as const).map((army) => (
          <div key={army} className={`team team-${army}`}>
            <h3>
              <span className={`pip pip-${army}`} />
              {army === 'w' ? 'White' : 'Black'}
            </h3>
            {seats
              .filter((slot) => SLOT_COLOR[slot] === army)
              .map((slot) => {
                const player = game.players?.[slot];
                const isMine = mySlot === slot;
                return (
                  <div key={slot} className={`seatrow ${isMine ? 'mine' : ''}`}>
                    <span className="slotname">{slot}</span>
                    {player ? (
                      <span className="occupant">
                        {player.name ?? 'Player'}
                        {isMine && <span className="you">you</span>}
                      </span>
                    ) : (
                      <button
                        disabled={busy || mySlot !== null}
                        onClick={() => onClaim(slot)}
                      >
                        Take this seat
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>

      <p className="hint">
        {mySlot === null
          ? 'Pick a seat. Teammates alternate turns commanding the same army.'
          : ready
            ? 'Everyone is seated.'
            : 'Waiting for the rest of the table.'}
      </p>

      <div className="actions row">
        <button className="primary" disabled={!ready || busy} onClick={onStart}>
          Start game
        </button>
        <button onClick={onLeave}>Back</button>
      </div>
    </div>
  );
}
