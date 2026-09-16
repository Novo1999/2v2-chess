/**
 * Room codes. One code per game, shared out of band — it is the capability
 * that gets three friends to the same node (decision #9).
 */

import { get, ref, set } from 'firebase/database';
import type { Database } from 'firebase/database';
import type { SeatCount } from './schema';
import { DEFAULT_CLOCK_MS, newGameNode } from './writes';

/** No 0/O, 1/I/L — these get read aloud over voice chat. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Codes are typed by humans, so accept the lowercase and the stray space. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidCode(input: string): boolean {
  return normalizeCode(input).length === CODE_LENGTH;
}

/**
 * Create a game under a fresh code. Rules refuse to overwrite an existing game,
 * so a collision fails the write rather than clobbering someone else's room —
 * the retry below is for tidiness, not for safety.
 */
export async function createGame(
  db: Database,
  seats: SeatCount,
  clockMs: number = DEFAULT_CLOCK_MS,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const snap = await get(ref(db, `games/${code}/status`));
    if (snap.exists()) continue;
    await set(ref(db, `games/${code}`), newGameNode(seats, clockMs));
    return code;
  }
  throw new Error('could not find a free room code');
}

export async function gameExists(db: Database, code: string): Promise<boolean> {
  const snap = await get(ref(db, `games/${code}/status`));
  return snap.exists();
}
