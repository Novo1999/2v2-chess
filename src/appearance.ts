/**
 * Board and piece choices — per player, saved in their own browser.
 *
 * A tiny external store rather than component state, so the picker on the home
 * screen and the one beside the board are always showing the same thing, and a
 * change in one tab reaches the others through the `storage` event.
 */

import { useSyncExternalStore } from 'react';

export const BOARDS = [
  { id: 'classic', label: 'Classic' },
  { id: 'dark-wood', label: 'Dark wood' },
  { id: 'walnut', label: 'Walnut' },
] as const;

export const PIECE_SETS = [
  { id: 'classic', label: 'Classic' },
  { id: 'neo', label: 'Neo' },
  { id: 'wood', label: 'Wood' },
] as const;

export type BoardId = (typeof BOARDS)[number]['id'];
export type PieceSetId = (typeof PIECE_SETS)[number]['id'];

export interface Appearance {
  board: BoardId;
  pieces: PieceSetId;
}

export const DEFAULT_APPEARANCE: Appearance = { board: 'classic', pieces: 'classic' };

const BOARD_KEY = 'consultation-chess:board';
const PIECES_KEY = 'consultation-chess:pieces';

function read<T extends string>(key: string, allowed: readonly { id: T }[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return allowed.some((option) => option.id === saved) ? (saved as T) : fallback;
  } catch {
    return fallback;
  }
}

function load(): Appearance {
  return {
    board: read(BOARD_KEY, BOARDS, DEFAULT_APPEARANCE.board),
    pieces: read(PIECES_KEY, PIECE_SETS, DEFAULT_APPEARANCE.pieces),
  };
}

let current: Appearance = load();
const listeners = new Set<() => void>();

function publish(next: Appearance) {
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key === BOARD_KEY || event.key === PIECES_KEY) publish(load());
  };
  window.addEventListener('storage', fromOtherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', fromOtherTab);
  };
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private browsing: the choice lasts until the tab closes */
  }
}

export function setBoard(board: BoardId) {
  save(BOARD_KEY, board);
  publish({ ...current, board });
}

export function setPieces(pieces: PieceSetId) {
  save(PIECES_KEY, pieces);
  publish({ ...current, pieces });
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_APPEARANCE);
}
