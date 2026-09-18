/**
 * What to call somebody who has not said who they are.
 *
 * The lobby already asks for a name and keeps it in localStorage, but the
 * online list has to show *everybody* who is connected, including the people
 * who opened the app thirty seconds ago and typed nothing. "Anonymous" four
 * times over is a useless list, so an unnamed player gets a handle instead.
 *
 * The handle is generated once and stored, not derived on each render: a name
 * that changed every time the page reloaded would be worse than no name, and
 * two tabs of the same browser should agree about who they are.
 */

const ALIAS_KEY = 'consultation-chess:alias';

/**
 * Two halves rather than one list, so a table of four is unlikely to contain
 * two of the same. Twenty by twenty-four is 480 handles, which is plenty for a
 * game whose threat model is "friends who know the room code".
 */
const VIBES = [
  'Skibidi',
  'Sigma',
  'Delulu',
  'Zesty',
  'Bussin',
  'Sussy',
  'Nonchalant',
  'Cooked',
  'Goated',
  'Mid',
  'Chopped',
  'Based',
  'Unspoken',
  'Certified',
  'Feral',
  'Menacing',
  'Ratioed',
  'Cringe',
  'Glazed',
  'Locked-In',
] as const;

const ROLES = [
  'Rizzler',
  'Yapper',
  'Mogger',
  'Glazer',
  'Baka',
  'NPC',
  'Aura Farmer',
  'Grindset',
  'Pookie',
  'Menace',
  'Twin',
  'Vro',
  'Blud',
  'Chad',
  'Opp',
  'Gyatt',
  'Fanum',
  'Looksmaxxer',
  'Sheesh',
  'Crashout',
  'Gooberling',
  'Bozo',
  'Sigma',
  'Toilet',
] as const;

/** The longest handle this can produce, for the 24-char rule on names. */
export const MAX_ALIAS_LENGTH = 24;

export function randomAlias(pick: () => number = Math.random): string {
  const vibe = VIBES[Math.floor(pick() * VIBES.length)] ?? VIBES[0];
  const role = ROLES[Math.floor(pick() * ROLES.length)] ?? ROLES[0];
  return `${vibe} ${role}`.slice(0, MAX_ALIAS_LENGTH);
}

/**
 * This browser's handle, minted on first use and kept afterwards. Falls back to
 * a fresh one each call if storage is denied, which is the private-browsing
 * case — the name is a nicety there, not something to fail over.
 */
export function alias(): string {
  try {
    const stored = localStorage.getItem(ALIAS_KEY);
    if (stored) return stored;
    const minted = randomAlias();
    localStorage.setItem(ALIAS_KEY, minted);
    return minted;
  } catch {
    return randomAlias();
  }
}

/**
 * What to show for a player: what they typed, or their handle. One function so
 * that the online list, the lobby and the seat badges cannot disagree.
 */
export function displayName(typed: string | undefined | null): string {
  const trimmed = typed?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : alias();
}
