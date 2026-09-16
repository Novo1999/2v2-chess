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

import { onDisconnect, ref, serverTimestamp, set, update } from 'firebase/database';
import type { Database } from 'firebase/database';
import type { Slot } from '../game/types';
import { claimSeatNode } from './writes';

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

/** Take an unoccupied seat, then mint the secret that makes it recoverable. */
export async function claimSeat(
  db: Database,
  gameId: string,
  slot: Slot,
  uid: string,
  name?: string,
): Promise<SeatTicket> {
  await set(ref(db, `games/${gameId}/players/${slot}`), claimSeatNode(uid, name));
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
 */
export function trackPresence(
  db: Database,
  gameId: string,
  slot: Slot,
): () => void {
  const node = ref(db, `games/${gameId}/players/${slot}`);
  const away = onDisconnect(node);
  void away.update({ connected: false, lastSeen: serverTimestamp() });
  void update(node, { connected: true, lastSeen: serverTimestamp() });

  return () => {
    void away.cancel();
    void update(node, { connected: false, lastSeen: serverTimestamp() });
  };
}
