import { useEffect, useState } from 'react';
import { Home } from './Home';
import { LocalGame } from './LocalGame';
import { OnlineGame } from './OnlineGame';
import { isConfigured } from './net/firebase';
import { useIdentity } from './net/hooks';

/**
 * Routing is the URL hash and nothing more. A room code in the address bar is
 * the thing people paste to each other, and it survives a refresh — which is
 * the case seat reclamation (decision #8) exists to handle.
 */
type Route = { at: 'home' } | { at: 'local' } | { at: 'game'; id: string };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash === 'local') return { at: 'local' };
  const match = /^g\/([A-Z0-9]+)$/.exec(hash.toUpperCase());
  return match?.[1] ? { at: 'game', id: match[1] } : { at: 'home' };
}

const NAME_KEY = 'consultation-chess:name';

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  function go(hash: string) {
    window.location.hash = hash;
    setRoute(parseHash());
  }

  function rename(next: string) {
    setName(next);
    try {
      localStorage.setItem(NAME_KEY, next);
    } catch {
      /* the name is a nicety, not a requirement */
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <a href="#" onClick={() => go('')}>
            Consultation Chess
          </a>
        </h1>
        <span className="sub">
          {route.at === 'local' ? 'hot seat' : route.at === 'game' ? route.id : '2v2'}
        </span>
      </header>

      {route.at === 'home' && (
        <Home
          name={name}
          onName={rename}
          onOpen={(id) => go(`/g/${id}`)}
          onHotSeat={() => go('/local')}
        />
      )}

      {route.at === 'local' && <LocalGame onExit={() => go('')} />}

      {route.at === 'game' &&
        (isConfigured ? (
          <Online gameId={route.id} name={name} onLeave={() => go('')} />
        ) : (
          <div className="notice error">
            <p>This build has no Firebase configuration, so online rooms are off.</p>
            <button onClick={() => go('')}>Back</button>
          </div>
        ))}
    </div>
  );
}

/** Sign-in is a precondition for every online screen, so it gates them all. */
function Online({
  gameId,
  name,
  onLeave,
}: {
  gameId: string;
  name: string;
  onLeave: () => void;
}) {
  const identity = useIdentity();

  if (identity.state === 'loading') return <p className="empty">Signing in…</p>;
  if (identity.state !== 'ready') {
    return (
      <div className="notice error">
        <p>
          Could not sign in anonymously
          {identity.state === 'error' ? `: ${identity.message}` : ''}. Anonymous
          auth has to be enabled on the Firebase project.
        </p>
        <button onClick={onLeave}>Back</button>
      </div>
    );
  }

  return (
    <OnlineGame
      gameId={gameId}
      uid={identity.value}
      name={name || 'Player'}
      onLeave={onLeave}
    />
  );
}
