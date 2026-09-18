import { getDb } from '../net/firebase';
import { dismissInvite, useInvites } from '../net/invites';

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
  const invite = invites[0];
  if (!me || !invite) return null;

  const clear = () => void dismissInvite(getDb(), me, invite.from).catch(() => {});

  return (
    <div className="notice invite" role="status">
      <p>
        <strong>{invite.name}</strong> invited you to a table.{' '}
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
          Join table
        </button>
        <button onClick={clear}>Dismiss</button>
      </div>
    </div>
  );
}
