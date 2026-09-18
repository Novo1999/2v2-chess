import { useEffect, useState } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import { Home } from './Home';
import { LocalGame } from './LocalGame';
import { OnlineGame } from './OnlineGame';
import { isConfigured } from './net/firebase';
import { useIdentity } from './net/hooks';
import { gameHash, parseHash, type Route } from './route';

const NAME_KEY = 'consultation-chess:name';

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  function go(hash: string) {
    window.location.hash = hash;
    setRoute(parseHash(window.location.hash));
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
    <Tooltip.Provider delay={350}>
      <div className="app">
      <header className="topbar">
        <h1>
          <a href="#" className="brand" onClick={() => go('')}>
            <img className="brand-logo" src="/favicon.svg" alt="" width={30} height={30} />
            Chesspacito
          </a>
        </h1>
        <span className="sub">
          {route.at === 'local' ? 'hot seat' : route.at === 'game' ? route.id : '2v2'}
        </span>
        <span className="spacer" />
        {route.at !== 'home' && (
          <button className="home-button" onClick={() => go('')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M12 3 2 11.5h3V21h5.5v-6h3v6H19v-9.5h3z" />
            </svg>
            Home
          </button>
        )}
      </header>

      {route.at === 'home' && (
        <Home
          name={name}
          onName={rename}
          onOpen={(id) => go(gameHash(id))}
          onHotSeat={() => go('/local')}
        />
      )}

      {route.at === 'local' && <LocalGame onExit={() => go('')} />}

      {route.at === 'game' &&
        (isConfigured ? (
          <Online gameId={route.id} name={name} onName={rename} onLeave={() => go('')} />
        ) : (
          <div className="notice error">
            <p>This build has no Firebase configuration, so online rooms are off.</p>
            <button onClick={() => go('')}>Back</button>
          </div>
        ))}
      </div>
    </Tooltip.Provider>
  );
}

/** Sign-in is a precondition for every online screen, so it gates them all. */
function Online({
  gameId,
  name,
  onName,
  onLeave,
}: {
  gameId: string;
  name: string;
  onName: (name: string) => void;
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
      name={name}
      onName={onName}
      onLeave={onLeave}
    />
  );
}
