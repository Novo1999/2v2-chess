/**
 * "Come and play" — a room code dropped into somebody's box.
 *
 * Sending is the host's alone, and only while the table is still being settled:
 * once the clocks start, the seats are the table's business and an invitation
 * into a game already under way is a different thing entirely. Rules enforce
 * both, reading the host and the status off the game the invite names.
 *
 * An invite is keyed by the SENDER, not by a push id. That is the whole
 * anti-spam story: one person owns exactly one slot in your box, so pressing
 * the button twice replaces their invite rather than stacking a second one up,
 * and there is nothing for anybody to flood you with.
 */

import { onValue, ref, remove, serverTimestamp, set } from 'firebase/database';
import type { Database } from 'firebase/database';
import { useEffect, useState } from 'react';
import { getDb } from './firebase';

export interface Invite {
  /** The uid that sent it, which is also its key. */
  from: string;
  /** What to call them — they may never have typed a name either. */
  name: string;
  /** The room code. */
  game: string;
  at: number;
}

export function sendInvite(
  db: Database,
  from: string,
  name: string,
  to: string,
  game: string,
): Promise<void> {
  return set(ref(db, `invites/${to}/${from}`), {
    name,
    game,
    at: serverTimestamp(),
  });
}

/** Clear an invite once it has been acted on, either way. */
export function dismissInvite(
  db: Database,
  to: string,
  from: string,
): Promise<void> {
  return remove(ref(db, `invites/${to}/${from}`));
}

/** Invites addressed to this player. Readable by nobody else. */
export function useInvites(uid: string | null): Invite[] {
  const [invites, setInvites] = useState<Invite[]>([]);

  useEffect(() => {
    if (!uid) {
      setInvites([]);
      return;
    }
    return onValue(
      ref(getDb(), `invites/${uid}`),
      (snap) => {
        const raw = (snap.val() ?? {}) as Record<
          string,
          { name?: string; game?: string; at?: number }
        >;
        setInvites(
          Object.entries(raw)
            .map(([from, entry]) => ({
              from,
              name: entry?.name ?? 'Someone',
              game: entry?.game ?? '',
              at: entry?.at ?? 0,
            }))
            .filter((invite) => invite.game.length > 0)
            .sort((a, b) => b.at - a.at),
        );
      },
      () => setInvites([]),
    );
  }, [uid]);

  return invites;
}
