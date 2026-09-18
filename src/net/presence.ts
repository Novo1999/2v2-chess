/**
 * Who is here right now.
 *
 * Separate from the per-seat presence in seat.ts, which answers "is the player
 * in P3 still attached to *this game*". This answers "who has the app open at
 * all", and so it lives at the root rather than under a game.
 *
 * The mechanism is the one seat.ts already proves: `onDisconnect` is registered
 * with the server, so the entry is removed even when the tab is closed mid-move
 * and there is no client left to run anything. Both halves are re-armed on
 * every reconnect, because a server-side disconnect handler fires once and is
 * then spent.
 */

import {
  onDisconnect,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
} from 'firebase/database';
import type { Database } from 'firebase/database';
import { useEffect, useRef, useState } from 'react';
import { getDb } from './firebase';

/** How often the entry is refreshed so `at` does not go stale under a long game. */
export const HEARTBEAT_MS = 45_000;

/**
 * How old an entry may be before the list stops believing it. Generous against
 * the heartbeat, because the cost of hiding somebody who is really there is
 * worse than the cost of showing somebody who left a minute ago — and
 * `onDisconnect` removes the common case immediately anyway.
 */
export const STALE_MS = 3 * HEARTBEAT_MS;

export interface OnlinePlayer {
  uid: string;
  name: string;
  at: number;
}

export interface Announcement {
  /** Re-send the entry, picking up whatever the name getter now returns. */
  announce: () => void;
  stop: () => void;
}

/**
 * The name is read through a getter rather than passed by value, so that
 * editing it does not tear the whole subscription down and rebuild it on every
 * keystroke — the caller re-announces once the typing settles.
 */
export function publishPresence(
  db: Database,
  uid: string,
  currentName: () => string,
): Announcement {
  const node = ref(db, `presence/${uid}`);
  const gone = onDisconnect(node);

  const announce = () =>
    void set(node, { name: currentName(), at: serverTimestamp() }).catch(() => {
      /* signed out, or rules refused. Nothing of ours to clean up. */
    });

  const stop = onValue(ref(db, '.info/connected'), (snap) => {
    if (snap.val() !== true) return;
    void gone.remove().then(announce, () => {});
  });

  const beat = setInterval(announce, HEARTBEAT_MS);

  return {
    announce,
    stop: () => {
      stop();
      clearInterval(beat);
      void gone.cancel();
      // Navigating away should not wait for a socket to drop.
      void remove(node).catch(() => {});
    },
  };
}

/** Announce this tab for as long as it is signed in, and keep the name current. */
export function useAnnouncePresence(uid: string | null, name: string): void {
  const latest = useRef(name);
  latest.current = name;
  const announce = useRef<() => void>(() => {});

  useEffect(() => {
    if (!uid) return;
    const handle = publishPresence(getDb(), uid, () => latest.current);
    announce.current = handle.announce;
    return handle.stop;
  }, [uid]);

  // A name edit is a keystroke at a time; the list only needs the result.
  useEffect(() => {
    if (!uid) return;
    const id = setTimeout(() => announce.current(), 600);
    return () => clearTimeout(id);
  }, [uid, name]);
}

/** Everyone currently announced, most recently seen first. */
export function useOnlinePlayers(enabled: boolean): OnlinePlayer[] {
  const [players, setPlayers] = useState<OnlinePlayer[]>([]);

  useEffect(() => {
    if (!enabled) return;
    return onValue(ref(getDb(), 'presence'), (snap) => {
      const raw = (snap.val() ?? {}) as Record<string, { name?: string; at?: number }>;
      setPlayers(
        Object.entries(raw)
          .map(([uid, entry]) => ({
            uid,
            name: entry?.name ?? '',
            at: entry?.at ?? 0,
          }))
          .sort((a, b) => b.at - a.at),
      );
    });
  }, [enabled]);

  return players;
}

/**
 * Drop entries whose heartbeat stopped. `onDisconnect` covers a dropped socket,
 * but not a machine that was suspended or a process killed before the server
 * noticed, so the reader does not take the list entirely on trust.
 */
export function liveOnly(
  players: readonly OnlinePlayer[],
  now: number,
): OnlinePlayer[] {
  return players.filter((player) => now - player.at < STALE_MS);
}
