import { useState } from 'react';
import { getDb, isConfigured } from './net/firebase';
import { createGame, isValidCode, normalizeCode } from './net/rooms';
import { DEFAULT_CLOCK_MS } from './net/writes';
import type { SeatCount } from './net/schema';
import { AppearancePicker } from './components/AppearancePicker';
import { ChoiceGroup } from './components/controls';
import { HEARTBEAT_MS, liveOnly, useOnlinePlayers } from './net/presence';
import { useTick } from './net/hooks';

interface Props {
  name: string;
  /** This tab's uid, so it can mark itself in the online list. */
  me: string | null;
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

/**
 * There are exactly three ways to start playing — open a table, join somebody
 * else's, or play everyone's seat on this device — so the page is laid out as
 * those three, with the one that takes decisions given the room to make them
 * and the two that take a moment kept small beside it.
 *
 * Your name comes first because every one of the three needs it, and the
 * appearance sits last because it is a preference, not a way in.
 */
export function Home({ name, me, onName, onOpen, onHotSeat }: Props) {
  const [code, setCode] = useState('');
  const [seats, setSeats] = useState<SeatCount>(4);
  const [clock, setClock] = useState(DEFAULT_CLOCK_MS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const named = name.trim().length > 0;

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
      <div className="home-col">
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

      <section className="card play-card">
        <header className="card-head">
          <h2>Open a table</h2>
          <p className="hint">
            You get a room code to read out. Everyone else joins with it.
          </p>
        </header>

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
          <ChoiceGroup
            label="Table"
            className="wide"
            value={String(seats)}
            onChange={(next) => setSeats(Number(next) as SeatCount)}
            options={[
              { id: '4', label: '4 players' },
              { id: '2', label: '2 players' },
            ]}
          />
          <p className="hint">
            {seats === 4
              ? 'Two per side. Teammates alternate turns commanding one army.'
              : 'One per side. Same rules, a two-seat rotation.'}
          </p>
        </div>

        <div className="field">
          <span className="label">Clock, per team</span>
          <ChoiceGroup
            label="Clock, per team"
            className="wide"
            value={String(clock)}
            onChange={(next) => setClock(Number(next))}
            options={CLOCK_CHOICES.map((choice) => ({
              id: String(choice.ms),
              label: choice.label,
            }))}
          />
        </div>

        <div className="card-foot">
          <button
            className="primary big"
            disabled={busy || !isConfigured || !named}
            onClick={create}
          >
            Create a room
          </button>
          {error && <p className="reject">{error}</p>}
        </div>
      </section>

      <section className="card online-card">
        <header className="card-head">
          <h2>Online now</h2>
          <p className="hint">
            Everyone with the app open. Read a room code out to whoever you want
            at your table.
          </p>
        </header>
        <OnlineList me={me} />
      </section>
      </div>

      <div className="home-col">
      <section className="card join-card">
        <header className="card-head">
          <h2>Join a table</h2>
          <p className="hint">Somebody read you five characters.</p>
        </header>

        <label className="field">
          <span className="label">Room code</span>
          <input
            type="text"
            className="codeinput"
            value={code}
            placeholder="ABCDE"
            maxLength={8}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isValidCode(code)) onOpen(normalizeCode(code));
            }}
          />
        </label>

        <div className="card-foot">
          <button
            className="primary"
            disabled={!isValidCode(code) || !isConfigured || !named}
            onClick={() => onOpen(normalizeCode(code))}
          >
            Join
          </button>
        </div>
      </section>

      <section className="card local-card">
        <header className="card-head">
          <h2>Hot seat</h2>
          <p className="hint">
            Every seat on one device, no network and no accounts. The same rules
            layer the online game uses, with the transport taken out.
          </p>
        </header>

        <div className="card-foot">
          <button onClick={onHotSeat}>Play locally</button>
        </div>
      </section>

      <section className="card look-card">
        <header className="card-head">
          <h2>Board &amp; pieces</h2>
          <p className="hint">Saved in this browser. Change it any time, in a game too.</p>
        </header>
        <AppearancePicker />
      </section>
      </div>
    </div>
  );
}

/**
 * Who else has the app open. Anyone who never typed a name is shown by the
 * handle their browser minted for them (see names.ts) — a list of four
 * "Anonymous" rows tells you nothing.
 */
function OnlineList({ me }: { me: string | null }) {
  const players = useOnlinePlayers(isConfigured);
  // The heartbeat is the freshness signal, so the list has to re-read the clock
  // on its own to drop somebody whose machine went to sleep.
  useTick(HEARTBEAT_MS, isConfigured);
  const live = liveOnly(players, Date.now());

  if (!isConfigured) {
    return <p className="hint">Needs a database — see “Open a table” above.</p>;
  }
  if (live.length === 0) {
    return <p className="hint">Nobody yet. You will appear here for others.</p>;
  }

  return (
    <ul className="onlinelist">
      {live.map((player) => (
        <li key={player.uid}>
          <span className="presence presence-on" aria-hidden="true" />
          <span className="online-name">{player.name}</span>
          {player.uid === me && <span className="you">you</span>}
        </li>
      ))}
    </ul>
  );
}
