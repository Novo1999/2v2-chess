/**
 * Routing is the URL hash and nothing more. A room code in the address bar is
 * the thing people paste to each other, and it survives a refresh — which is
 * the case seat reclamation (decision #8) exists to handle.
 */

export type Route = { at: 'home' } | { at: 'local' } | { at: 'game'; id: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'local') return { at: 'local' };

  // Case-insensitive on the whole path, and only the code is normalised. An
  // earlier version upper-cased the path and then matched a lowercase `g/`,
  // so every room URL silently fell through to the home screen.
  const match = /^g\/([a-z0-9]+)$/i.exec(path);
  return match?.[1] ? { at: 'game', id: match[1].toUpperCase() } : { at: 'home' };
}

export function gameHash(id: string): string {
  return `/g/${id}`;
}
