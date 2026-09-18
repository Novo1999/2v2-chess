import type { Slot } from '../game/types';
import { SLOT_COLOR } from '../game/types';
import type { NetGame, Offer } from '../net/schema';
import { allSeatsFilled, canStart, seatsOf } from '../net/schema';
import { consentOutstanding, heldByOther } from '../net/writes';
import { PresenceIcon } from './Presence';

interface Props {
  gameId: string;
  game: NetGame;
  mySlot: Slot | null;
  uid: string;
  now: number;
  name: string;
  onName: (name: string) => void;
  busy: boolean;
  onClaim: (slot: Slot) => void;
  /** Move from the seat you hold to an empty one. */
  onMoveSeat: (slot: Slot) => void;
  onLeaveSeat: () => void;
  onProposeSwap: (withSlot: Slot) => void;
  onAcceptSwap: () => void;
  onDeclineSwap: () => void;
  onStart: () => void;
  onLeave: () => void;
}

/**
 * Seats are chosen, not handed out (decision #9). Four friends in a voice call
 * settle who is on whose team by talking about it, which is the one mechanism
 * guaranteed to be available to them.
 *
 * So the lobby's job is to make the arrangement they agreed out loud easy to
 * reach: take a seat, move to a different one, trade with somebody, or start a
 * man down because the fourth is not coming.
 */
export function Lobby({
  gameId,
  game,
  mySlot,
  uid,
  now,
  name,
  onName,
  busy,
  onClaim,
  onMoveSeat,
  onLeaveSeat,
  onProposeSwap,
  onAcceptSwap,
  onDeclineSwap,
  onStart,
  onLeave,
}: Props) {
  const seats = seatsOf(game);
  const ready = canStart(game);
  const full = allSeatsFilled(game);
  // Friends usually arrive by pasted link and never see the home screen, so the
  // lobby is the one place every player is guaranteed to pass through.
  const named = name.trim().length > 0;
  const swap = game.offer?.kind === 'swap' ? game.offer : null;

  return (
    <div className="lobby">
      <div className="roomcode">
        <span className="label">Room code</span>
        <code>{gameId}</code>
        <button onClick={() => void navigator.clipboard?.writeText(gameId)}>
          Copy
        </button>
      </div>

      {mySlot === null && (
        <label className="field">
          <span className="label">Your name</span>
          <input
            type="text"
            value={name}
            maxLength={24}
            placeholder="so your friends know which seat is you"
            autoFocus={!named}
            onChange={(e) => onName(e.target.value)}
          />
        </label>
      )}

      {swap && (
        <SwapPrompt
          game={game}
          offer={swap}
          mySlot={mySlot}
          busy={busy}
          onAccept={onAcceptSwap}
          onDecline={onDeclineSwap}
        />
      )}

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
                const held = heldByOther(game, slot, uid, now);

                return (
                  <div key={slot} className={`seatrow ${isMine ? 'mine' : ''}`}>
                    <span className="slotname">{slot}</span>

                    {player ? (
                      <span className="occupant">
                        {player.name ?? 'Player'}
                        {isMine && <span className="you">you</span>}
                        <PresenceIcon connected={player.connected !== false} />
                      </span>
                    ) : held ? (
                      // Somebody clicked this a moment ago. Saying so before
                      // the click is kinder than saying it after.
                      <span className="occupant taking">Being taken…</span>
                    ) : (
                      <button
                        disabled={busy || !named || swap !== null}
                        onClick={() => (mySlot ? onMoveSeat(slot) : onClaim(slot))}
                      >
                        {mySlot ? 'Move here' : 'Take this seat'}
                      </button>
                    )}

                    {isMine && (
                      <button
                        className="seat-action"
                        disabled={busy || swap !== null}
                        onClick={onLeaveSeat}
                      >
                        Leave seat
                      </button>
                    )}

                    {player && !isMine && mySlot && (
                      <button
                        className="seat-action"
                        disabled={busy || swap !== null}
                        onClick={() => onProposeSwap(slot)}
                      >
                        Swap
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>

      <p className="hint">{hintFor({ mySlot, named, ready, full })}</p>

      <div className="actions row">
        <button className="primary" disabled={!ready || busy} onClick={onStart}>
          {ready && !full ? 'Start a man down' : 'Start game'}
        </button>
        <button onClick={onLeave}>Back</button>
      </div>
    </div>
  );
}

function hintFor({
  mySlot,
  named,
  ready,
  full,
}: {
  mySlot: Slot | null;
  named: boolean;
  ready: boolean;
  full: boolean;
}): string {
  if (mySlot === null) {
    return named
      ? 'Pick a seat. Teammates alternate turns commanding the same army.'
      : 'Enter your name, then pick a seat.';
  }
  if (full) return 'Everyone is seated.';
  if (ready) {
    return 'You can wait, or start now — an empty seat is played by its' +
      ' teammate, and anyone who turns up later can drop straight into it.';
  }
  return 'Waiting for somebody on the other side.';
}

/**
 * A swap is consent, so it is the same two-signature question as a draw — and
 * it blocks the rest of the lobby while it is open, because every other button
 * here would be answering a question that is about to change.
 */
function SwapPrompt({
  game,
  offer,
  mySlot,
  busy,
  onAccept,
  onDecline,
}: {
  game: NetGame;
  offer: Offer;
  mySlot: Slot | null;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const there = offer.with;
  if (!there) return null;

  const nameOf = (slot: Slot) => game.players?.[slot]?.name ?? slot;
  const mine = mySlot === offer.by || mySlot === there;
  const waiting = consentOutstanding(game, offer);
  const yours = mySlot !== null && waiting.includes(mySlot);

  return (
    <div className="notice offer">
      <p>
        <strong>{nameOf(offer.by)}</strong> ({offer.by}) wants to swap seats with{' '}
        <strong>{nameOf(there)}</strong> ({there}).
      </p>
      <div className="actions row">
        {yours ? (
          <button className="primary" disabled={busy} onClick={onAccept}>
            Accept swap
          </button>
        ) : (
          <span className="hint">
            {mine ? 'Waiting for the other seat…' : 'Waiting on the two of them…'}
          </span>
        )}
        {mySlot && (
          <button disabled={busy} onClick={onDecline}>
            {yours ? 'Decline' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  );
}
