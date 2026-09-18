/**
 * Claiming, keeping, and reclaiming a seat (PLAN.md decisions #8 and #9).
 *
 * The write order here is load-bearing and enforced by rules:
 *
 *   claim  -> players/$slot (allowed because the seat is empty)
 *          -> secrets/$gid/$slot (allowed only to whoever now holds the seat)
 *
 *   return -> proof/$gid/$uid/$slot (write-only, nobody can read it back)
 *          -> players/$slot (allowed because proof now matches the secret)
 *
 * Minting the secret second is what stops a bystander from locking a seat they
 * never sat in; writing proof first is what lets rules compare against a value
 * the client is not allowed to read.
 */

import { onDisconnect, onValue, ref, serverTimestamp, set, update } from 'firebase/database';
import type { Database } from 'firebase/database';
import type { Slot } from '../game/types';
import { claimSeatNode, holdUpdate } from './writes';

const STORE_PREFIX = 'consultation-chess:seat:';

export interface SeatTicket {
  slot: Slot;
  secret: string;
}

/** Long enough that guessing is not a threat model; rules demand >= 20 chars. */
function mintSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function rememberSeat(gameId: string, ticket: SeatTicket): void {
  try {
    localStorage.setItem(STORE_PREFIX + gameId, JSON.stringify(ticket));
  } catch {
    // Private browsing with storage denied. The seat still works for this
    // session; only the ability to come back to it is lost.
  }
}

export function recallSeat(gameId: string): SeatTicket | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + gameId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SeatTicket;
    return parsed.slot && parsed.secret ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetSeat(gameId: string): void {
  try {
    localStorage.removeItem(STORE_PREFIX + gameId);
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Take an unoccupied seat, then mint the secret that makes it recoverable.
 *
 * The hold goes first so that everyone else's copy of the lobby greys this seat
 * out for the moment it takes to sit down. It is released in the same update
 * that claims the seat, so the window is as short as the round trip.
 */
export async function claimSeat(
  db: Database,
  gameId: string,
  slot: Slot,
  uid: string,
  name?: string,
): Promise<SeatTicket> {
  await hold(db, gameId, slot, uid);
  await update(ref(db), {
    [`games/${gameId}/players/${slot}`]: claimSeatNode(uid, name),
    [`games/${gameId}/reserve/${slot}`]: null,
  });
  return mint(db, gameId, slot);
}

/**
 * Stand up. The secret goes with the seat, in the same update.
 *
 * Leaving it behind would not merely be untidy — `claimable` refuses a seat
 * that still has a secret on it, so a seat vacated without clearing it would be
 * unclaimable by everyone, including the player who just left.
 */
export async function vacateSeat(
  db: Database,
  gameId: string,
  slot: Slot,
): Promise<void> {
  await update(ref(db), {
    [`games/${gameId}/players/${slot}`]: null,
    [`secrets/${gameId}/${slot}`]: null,
  });
  forgetSeat(gameId);
}

/**
 * Move to an empty seat: stand up and sit down in one atomic update, so the
 * seat being left cannot be taken out from under a half-finished move, and the
 * seat being taken is already held.
 */
export async function moveToSeat(
  db: Database,
  gameId: string,
  from: Slot,
  to: Slot,
  uid: string,
  name?: string,
): Promise<SeatTicket> {
  await hold(db, gameId, to, uid);
  await update(ref(db), {
    [`games/${gameId}/players/${from}`]: null,
    [`secrets/${gameId}/${from}`]: null,
    [`games/${gameId}/players/${to}`]: claimSeatNode(uid, name),
    [`games/${gameId}/reserve/${to}`]: null,
  });
  return mint(db, gameId, to);
}

/**
 * Take ownership of a seat arrived in by a swap. The seat still carries the
 * other player's secret, and only its current holder may replace it — which,
 * after the swap landed, is now us.
 */
export async function remintSecret(
  db: Database,
  gameId: string,
  slot: Slot,
): Promise<SeatTicket> {
  return mint(db, gameId, slot);
}

/** Claim the two-second hold, translating the refusal into something readable. */
async function hold(
  db: Database,
  gameId: string,
  slot: Slot,
  uid: string,
): Promise<void> {
  try {
    await set(ref(db, `games/${gameId}/reserve/${slot}`), holdUpdate(uid));
  } catch {
    throw new Error(`${slot} is being taken by somebody else right now`);
  }
}

async function mint(
  db: Database,
  gameId: string,
  slot: Slot,
): Promise<SeatTicket> {
  const secret = mintSecret();
  await set(ref(db, `secrets/${gameId}/${slot}`), secret);
  const ticket = { slot, secret };
  rememberSeat(gameId, ticket);
  return ticket;
}

/**
 * Come back to a seat already held — the same browser after a refresh, or a
 * different one entirely carrying the ticket.
 */
export async function reclaimSeat(
  db: Database,
  gameId: string,
  ticket: SeatTicket,
  uid: string,
  name?: string,
): Promise<void> {
  await set(ref(db, `proof/${gameId}/${uid}/${ticket.slot}`), ticket.secret);
  await set(
    ref(db, `games/${gameId}/players/${ticket.slot}`),
    claimSeatNode(uid, name),
  );
  rememberSeat(gameId, ticket);
}

/**
 * Presence. `onDisconnect` is registered with the server, so it fires even when
 * the tab is closed mid-move — which is the case the grace period exists for.
 *
 * A server-side disconnect handler fires once and is then spent, and a dropped
 * connection that comes back is a new session to the server. So both halves
 * are redone on every (re)connect, or a player whose Wi-Fi blinked would stay
 * marked as gone for the rest of the game.
 */
export function trackPresence(
  db: Database,
  gameId: string,
  slot: Slot,
): () => void {
  const node = ref(db, `games/${gameId}/players/${slot}`);
  const away = onDisconnect(node);

  const stop = onValue(ref(db, '.info/connected'), (snap) => {
    if (snap.val() !== true) return;
    void away
      .update({ connected: false, lastSeen: serverTimestamp() })
      .then(() => update(node, { connected: true, lastSeen: serverTimestamp() }))
      .catch(() => {
        /* the seat was lost meanwhile; nothing of ours to mark */
      });
  });

  return () => {
    stop();
    void away.cancel();
    void update(node, { connected: false, lastSeen: serverTimestamp() }).catch(() => {});
  };
}
