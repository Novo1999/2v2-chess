import { useState } from 'react';
import { getDb } from '../net/firebase';
import { sendInvite } from '../net/invites';
import { HEARTBEAT_MS, liveOnly, useOnlinePlayers } from '../net/presence';
import { useTick } from '../net/hooks';

/**
 * Pull somebody in off the online list.
 *
 * Only the host sees this, and only in the lobby — the caller decides that, and
 * rules enforce it, so a client that got it wrong would simply be refused.
 *
 * There is no accept step on this side: an invite is a room code delivered, and
 * the room is already open. What it saves is reading five characters out loud.
 */
export function InvitePanel({
  me,
  myName,
  gameId,
  seated,
}: {
  me: string;
  myName: string;
  gameId: string;
  /** Uids already at this table, which have nothing to be invited to. */
  seated: readonly string[];
}) {
  const players = useOnlinePlayers(true);
  useTick(HEARTBEAT_MS, true);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const invitable = liveOnly(players, Date.now()).filter(
    (player) => player.uid !== me && !seated.includes(player.uid),
  );

  if (invitable.length === 0) {
    return (
      <div className="field">
        <span className="label">Invite</span>
        <p className="hint">
          Nobody else is online right now. The room code works just as well.
        </p>
      </div>
    );
  }

  return (
    <div className="field">
      <span className="label">Invite</span>
      <ul className="invitelist">
        {invitable.map((player) => (
          <li key={player.uid}>
            <span className="presence presence-on" aria-hidden="true" />
            <span className="online-name">{player.name}</span>
            <button
              className="seat-action"
              disabled={player.inRoom || sent[player.uid]}
              onClick={() => {
                setError(null);
                sendInvite(getDb(), me, myName, player.uid, gameId).then(
                  () => setSent((was) => ({ ...was, [player.uid]: true })),
                  (err: Error) => setError(err.message),
                );
              }}
            >
              {player.inRoom ? 'In a room' : sent[player.uid] ? 'Invited' : 'Invite'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="reject">{error}</p>}
    </div>
  );
}
