import { useCallback, useEffect, useRef, useState } from 'react';
import { child, push, ref, update } from 'firebase/database';
import type { MoveIntent, Slot } from './game/types';
import { SLOT_COLOR } from './game/types';
import { getDb } from './net/firebase';
import { useConnected, useGame, useServerNow, useTick } from './net/hooks';
import type { NetGame } from './net/schema';
import { seatsOf, teammateIn, toGameState } from './net/schema';
import {
  claimSeat,
  forgetSeat,
  recallSeat,
  reclaimSeat,
  trackPresence,
} from './net/seat';
import {
  clearOfferUpdate,
  clockNow,
  consentComplete,
  hasFlagged,
  mayMoveNow,
  moveUpdate,
  offerFields,
  seatOfUid,
  settleOfferUpdate,
  startUpdate,
  takeoverIn,
  timeoutUpdate,
} from './net/writes';
import { GameView } from './components/GameView';
import { Lobby } from './components/Lobby';
import { Clock } from './components/Clock';
import { OfferPanel } from './components/OfferPanel';

interface Props {
  gameId: string;
  uid: string;
  name: string;
  onLeave: () => void;
}

export function OnlineGame({ gameId, uid, name, onLeave }: Props) {
  const loaded = useGame(gameId);
  const serverNow = useServerNow();
  const online = useConnected();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const game = loaded.state === 'ready' ? loaded.value : null;
  const active = game?.status === 'active';
  // The clocks and the grace countdown are both wall-clock readings, so the
  // view has to re-render on its own even when nothing has been written.
  useTick(200, active || game?.status === 'lobby');

  const mySlot = game ? seatOfUid(game, uid) : null;

  useReclaimSeat(gameId, game, uid, name, mySlot, setError);
  usePresence(gameId, mySlot);
  useFlagCaller(gameId, game, mySlot, serverNow);
  useConsentSettler(gameId, game, mySlot);

  const write = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await update(ref(getDb(), `games/${gameId}`), payload);
      } catch (err) {
        // The SDK has already reverted the optimistic local write by now, so
        // there is nothing to roll back here — only something to explain.
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [gameId],
  );

  const onMove = useCallback(
    (intent: MoveIntent) => {
      if (!game) return;
      const key = push(child(ref(getDb(), `games/${gameId}`), 'moves')).key;
      if (!key) return;
      const built = moveUpdate(game, intent, key, serverNow());
      if (!built.ok) {
        setError(built.reason);
        return;
      }
      void write(built.update);
    },
    [game, gameId, serverNow, write],
  );

  if (loaded.state === 'loading') return <p className="empty">Loading room…</p>;
  if (loaded.state === 'missing') {
    return (
      <div className="notice">
        <p>No game with the code {gameId}.</p>
        <button onClick={onLeave}>Back</button>
      </div>
    );
  }
  if (loaded.state === 'error') {
    return (
      <div className="notice error">
        <p>{loaded.message}</p>
        <button onClick={onLeave}>Back</button>
      </div>
    );
  }

  const live = loaded.value;

  if (live.status === 'lobby') {
    return (
      <>
        {error && <p className="reject">{error}</p>}
        <Lobby
          gameId={gameId}
          game={live}
          mySlot={mySlot}
          busy={busy}
          onClaim={(slot) => {
            setBusy(true);
            setError(null);
            claimSeat(getDb(), gameId, slot, uid, name)
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false));
          }}
          onStart={() => void write(startUpdate())}
          onLeave={onLeave}
        />
      </>
    );
  }

  const now = serverNow();
  const canMove = mayMoveNow(live, uid, now);
  const orientation = mySlot ? SLOT_COLOR[mySlot] : 'w';
  const offer = live.offer?.kind ? live.offer : null;

  return (
    <>
      <GameView
        state={toGameState(live)}
        controls={canMove ? [live.toMove] : []}
        you={mySlot}
        orientation={orientation}
        onMove={onMove}
        banner={
          <>
            {!online && <p className="reject">Reconnecting…</p>}
            {error && <p className="reject">{error}</p>}
            <TakeoverNotice game={live} mySlot={mySlot} now={now} />
          </>
        }
        aside={
          <>
            <div className="clocks">
              <Clock
                ms={clockNow(live, 'b', now)}
                army="b"
                running={live.status === 'active' && SLOT_COLOR[live.toMove] === 'b'}
                sharedBy={armyLabel(live, 'b')}
              />
              <Clock
                ms={clockNow(live, 'w', now)}
                army="w"
                running={live.status === 'active' && SLOT_COLOR[live.toMove] === 'w'}
                sharedBy={armyLabel(live, 'w')}
              />
            </div>
            <div className="roomcode small">
              <span className="label">Room</span>
              <code>{gameId}</code>
            </div>
            {offer && (
              <OfferPanel
                game={live}
                offer={offer}
                mySlot={mySlot}
                // Only the signature. Rules read consent from the pre-write
                // tree, so the last accepter cannot also end the game in the
                // same update — their own "yes" is not visible to the rule yet.
                // The settling write is a separate step, below.
                onAccept={() => {
                  if (!mySlot) return;
                  void write({ [`offer/accept/${mySlot}`]: true });
                }}
                onDecline={() => void write(clearOfferUpdate(seatsOf(live)))}
              />
            )}
          </>
        }
        actions={
          <>
            {live.status === 'active' && mySlot && !offer && (
              <>
                <button onClick={() => void write(propose('draw', mySlot))}>
                  Offer draw
                </button>
                <button className="danger" onClick={() => void write(propose('resign', mySlot))}>
                  Resign
                </button>
              </>
            )}
            <button onClick={onLeave}>Leave</button>
          </>
        }
      />
    </>
  );
}

/** An offer plus the offerer's own signature, in one update. */
function propose(kind: 'draw' | 'resign', by: Slot): Record<string, unknown> {
  return { ...offerFields(kind, by), [`offer/accept/${by}`]: true };
}

function armyLabel(game: NetGame, army: 'w' | 'b'): string {
  return seatsOf(game)
    .filter((slot) => SLOT_COLOR[slot] === army)
    .map((slot) => game.players?.[slot]?.name ?? slot)
    .join(' & ');
}

/**
 * The visible half of decision #10. A shared clock draining on somebody else's
 * absence is worth saying out loud, and so is the moment it becomes yours to
 * play through.
 */
function TakeoverNotice({
  game,
  mySlot,
  now,
}: {
  game: NetGame;
  mySlot: Slot | null;
  now: number;
}) {
  if (!mySlot || game.status !== 'active') return null;
  const onMove = game.toMove;
  if (onMove === mySlot) return null;
  if (teammateIn(game.rotation, onMove) !== mySlot) return null;

  const seconds = takeoverIn(game, onMove, now);
  if (seconds === null) return null;

  return (
    <p className="reject takeover">
      {seconds > 0
        ? `${onMove} is disconnected — your team's clock is still running. You can play their turn in ${seconds}s.`
        : `${onMove} is away. Play their turn for them.`}
    </p>
  );
}

/** Reclaim a seat this browser holds a ticket for (decision #8). */
function useReclaimSeat(
  gameId: string,
  game: NetGame | null,
  uid: string,
  name: string,
  mySlot: Slot | null,
  setError: (message: string) => void,
) {
  const attempted = useRef('');

  useEffect(() => {
    if (!game || mySlot) return;
    const ticket = recallSeat(gameId);
    if (!ticket) return;

    const holder = game.players?.[ticket.slot]?.uid;
    if (holder === uid) return;

    const key = `${gameId}:${uid}:${ticket.slot}`;
    if (attempted.current === key) return;
    attempted.current = key;

    reclaimSeat(getDb(), gameId, ticket, uid, name).catch((err: Error) => {
      // The seat was given away, or the ticket is stale. Either way it is no
      // longer ours, and holding on to it would only retry forever.
      forgetSeat(gameId);
      setError(`Could not reclaim ${ticket.slot}: ${err.message}`);
    });
  }, [game, gameId, mySlot, name, setError, uid]);
}

function usePresence(gameId: string, mySlot: Slot | null) {
  useEffect(() => {
    if (!mySlot) return;
    return trackPresence(getDb(), gameId, mySlot);
  }, [gameId, mySlot]);
}

/**
 * Once the last player has agreed, somebody has to write the ending — rules
 * check consent against the pre-write tree, so it cannot ride along with the
 * final acceptance. Every seated client tries; the first one wins and the rest
 * fail against a game that is no longer active.
 */
function useConsentSettler(
  gameId: string,
  game: NetGame | null,
  mySlot: Slot | null,
) {
  useEffect(() => {
    if (!game || !mySlot || game.status !== 'active') return;
    const offer = game.offer;
    if (!offer?.kind || !consentComplete(game, offer)) return;

    void update(ref(getDb(), `games/${gameId}`), {
      ...settleOfferUpdate(offer),
      ...clearOfferUpdate(seatsOf(game)),
    }).catch(() => {
      // Another client got there first. The listener will show the result.
    });
  }, [game, gameId, mySlot]);
}

/**
 * Somebody has to notice the flag, because nothing server-side is watching.
 * Every seated client tries; rules verify the claim against `now`, and the
 * losers of the race simply fail against a game that is no longer active.
 */
function useFlagCaller(
  gameId: string,
  game: NetGame | null,
  mySlot: Slot | null,
  serverNow: () => number,
) {
  const called = useRef(false);

  useEffect(() => {
    if (!game || !mySlot) return;
    if (game.status !== 'active') {
      called.current = false;
      return;
    }
    if (called.current) return;

    const id = setInterval(() => {
      if (!hasFlagged(game, serverNow()) || called.current) return;
      called.current = true;
      void update(ref(getDb(), `games/${gameId}`), timeoutUpdate(game)).catch(
        () => {
          called.current = false;
        },
      );
    }, 500);

    return () => clearInterval(id);
  }, [game, gameId, mySlot, serverNow]);
}
