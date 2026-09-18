import { useEffect, useRef } from 'react';
import { getDb } from '../net/firebase';
import { dismissInvite, useInvites } from '../net/invites';
import { playInviteSound } from '../sound';

/**
 * An invitation that arrived. It sits above whatever screen you are on, because
 * the point of being invited is that you were not looking for the room.
 *
 * Accepting is just opening it — the room is already there and the seats are
 * still being claimed, so there is nothing to agree to. Only the newest is
 * shown; the rest wait behind it rather than stacking into a wall of banners.
 */
export function InviteBanner({
  me,
  onOpen,
}: {
  me: string | null;
  onOpen: (gameId: string) => void;
}) {
  const invites = useInvites(me);
  const heard = useRef({ me, versions: new Map<string, string>() });

  useEffect(() => {
    if (heard.current.me !== me) {
      heard.current = { me, versions: new Map() };
    }
    if (!me) return;

    let arrived = false;
    for (const invite of invites) {
      const version = `${invite.game}:${invite.at}`;
      if (heard.current.versions.get(invite.from) === version) continue;
      heard.current.versions.set(invite.from, version);
      arrived = true;
    }
    // Dismissing the newest banner can reveal an older invite; it is not new.
    if (arrived) playInviteSound();
  }, [me, invites]);

  const invite = invites[0];
  if (!me || !invite) return null;

  const clear = () => void dismissInvite(getDb(), me, invite.from).catch(() => {});

  return (
    <div className="notice invite" role="status">
      <p>
        <strong>{invite.name}</strong> invited you to a chess match.{' '}
        <code>{invite.game}</code>
        {invites.length > 1 && (
          <span className="hint"> · {invites.length - 1} more waiting</span>
        )}
      </p>
      <div className="actions row">
        <button
          className="primary"
          onClick={() => {
            clear();
            onOpen(invite.game);
          }}
        >
          Join room
        </button>
        <button onClick={clear}>Dismiss</button>
      </div>
    </div>
  );
}
