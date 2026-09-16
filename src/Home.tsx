import { useState } from 'react';
import { getDb, isConfigured } from './net/firebase';
import { createGame, isValidCode, normalizeCode } from './net/rooms';
import { DEFAULT_CLOCK_MS } from './net/writes';
import type { SeatCount } from './net/schema';
import { AppearancePicker } from './components/AppearancePicker';

interface Props {
  name: string;
  onName: (name: string) => void;
  onOpen: (gameId: string) => void;
  onHotSeat: () => void;
}

const CLOCK_CHOICES = [
  { label: '5 min', ms: 5 * 60 * 1000 },
  { label: '10 min', ms: DEFAULT_CLOCK_MS },
  { label: '30 min', ms: 30 * 60 * 1000 },
  { label: '60 min', ms: 60 * 60 * 1000 },
];

export function Home({ name, onName, onOpen, onHotSeat }: Props) {
  const [code, setCode] = useState('');
  const [seats, setSeats] = useState<SeatCount>(4);
  const [clock, setClock] = useState(DEFAULT_CLOCK_MS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function create() {
    setBusy(true);
    setError(null);
    createGame(getDb(), seats, clock)
      .then(onOpen)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <div className="home">
      <section className="card name-card">
        <label className="field">
          <span className="label">Your name</span>
          <input
            type="text"
            value={name}
            maxLength={24}
            placeholder="who are you"
            onChange={(e) => onName(e.target.value)}
          />
        </label>
        <p className="hint">
          Shown to the other players, and remembered on this device.
        </p>
      </section>

      <div className="home-column">
      <section className="card">
        <h2>Play online</h2>
        {!isConfigured && (
          <div className="reject">
            <p>
              <strong>No database configured</strong>, so online rooms are off.
            </p>
            <p>
              To play with friends over the internet, put your Firebase project
              details in <code>.env.local</code> — see “Using a real Firebase
              project” in the README.
            </p>
            <p>
              To play on this machine with no account at all, run{' '}
              <code>npm run emulator</code> and <code>npm run dev:local</code>.
            </p>
            <p className="hint">
              Vite reads env files at startup, so restart the dev server after
              editing one.
            </p>
          </div>
        )}

        <div className="field">
          <span className="label">Table</span>
          <div className="row">
            <button
              className={seats === 4 ? 'primary' : ''}
              onClick={() => setSeats(4)}
            >
              4 players
            </button>
            <button
              className={seats === 2 ? 'primary' : ''}
              onClick={() => setSeats(2)}
            >
              2 players
            </button>
          </div>
          <p className="hint">
            {seats === 4
              ? 'Two per side. Teammates alternate turns commanding one army.'
              : 'One per side. Same rules, a two-seat rotation.'}
          </p>
        </div>

        <div className="field">
          <span className="label">Clock, per team</span>
          <div className="row">
            {CLOCK_CHOICES.map((choice) => (
              <button
                key={choice.ms}
                className={clock === choice.ms ? 'primary' : ''}
                onClick={() => setClock(choice.ms)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>

        <button
          className="primary big"
          disabled={busy || !isConfigured || !name.trim()}
          onClick={create}
        >
          Create a room
        </button>
        {error && <p className="reject">{error}</p>}
      </section>

      <section className="card">
        <h2>Board &amp; pieces</h2>
        <AppearancePicker />
        <p className="hint">Saved in this browser. Change it any time, in a game too.</p>
      </section>
      </div>

      <section className="card">
        <h2>Join a room</h2>
        <label className="field">
          <span className="label">Room code</span>
          <input
            type="text"
            value={code}
            placeholder="ABCDE"
            maxLength={8}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isValidCode(code)) onOpen(normalizeCode(code));
            }}
          />
        </label>
        <button
          className="primary"
          disabled={!isValidCode(code) || !isConfigured || !name.trim()}
          onClick={() => onOpen(normalizeCode(code))}
        >
          Join
        </button>
      </section>

      <section className="card">
        <h2>Hot seat</h2>
        <p className="hint">
          Every seat on one device, no network and no accounts. The same rules
          layer the online game uses, with the transport taken out.
        </p>
        <button onClick={onHotSeat}>Play locally</button>
      </section>
    </div>
  );
}
