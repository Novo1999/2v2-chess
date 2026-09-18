/**
 * The listener layer. Decision #7: one subscription drives the board, and the
 * SDK's local-first writes plus automatic revert-on-reject are the optimistic
 * UI — there is no second state machine here to keep in step.
 */

import { useEffect, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { getDb, signIn } from './firebase';
import type { NetGame } from './schema';

export type Loading<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'missing' }
  | { state: 'error'; message: string };

/** Anonymous sign-in, held for the life of the tab. */
export function useIdentity(enabled = true): Loading<string> {
  const [result, setResult] = useState<Loading<string>>({ state: 'loading' });

  useEffect(() => {
    // A build with no database configured has nothing to sign in to.
    if (!enabled) return;
    let live = true;
    signIn().then(
      (uid) => live && setResult({ state: 'ready', value: uid }),
      (err: Error) => live && setResult({ state: 'error', message: err.message }),
    );
    return () => {
      live = false;
    };
  }, [enabled]);

  return result;
}

/** The single listener. Every rendered thing downstream is a view of this. */
export function useGame(gameId: string | null): Loading<NetGame> {
  const [result, setResult] = useState<Loading<NetGame>>({ state: 'loading' });

  useEffect(() => {
    if (!gameId) return;
    setResult({ state: 'loading' });
    return onValue(
      ref(getDb(), `games/${gameId}`),
      (snap) =>
        setResult(
          snap.exists()
            ? { state: 'ready', value: snap.val() as NetGame }
            : { state: 'missing' },
        ),
      (err) => setResult({ state: 'error', message: err.message }),
    );
  }, [gameId]);

  return result;
}

/**
 * Server time, which is the only clock the rules agree with. Everything that
 * compares against `lastMoveAt` — the clocks, the grace period, the flag — uses
 * this rather than the local wall clock.
 */
export function useServerNow(): () => number {
  const offset = useRef(0);

  useEffect(
    () =>
      onValue(ref(getDb(), '.info/serverTimeOffset'), (snap) => {
        offset.current = (snap.val() as number) ?? 0;
      }),
    [],
  );

  return () => Date.now() + offset.current;
}

/** Re-render on a timer, for the clock readouts and the grace countdown. */
export function useTick(ms: number, active = true): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}

/** True once the browser reports a live connection to the database. */
export function useConnected(): boolean {
  const [connected, setConnected] = useState(true);
  useEffect(
    () =>
      onValue(ref(getDb(), '.info/connected'), (snap) =>
        setConnected(Boolean(snap.val())),
      ),
    [],
  );
  return connected;
}
