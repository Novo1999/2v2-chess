/**
 * The security rules ARE the security model (PLAN.md decision #5), so these
 * tests assert the attacks directly rather than the happy path alone.
 *
 * Run with `npm run test:rules`, which wraps the suite in a database emulator.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { get, push, ref, set, update, child } from 'firebase/database';
import type { Database } from 'firebase/database';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Slot } from '../src/game/types';
import type { NetGame } from '../src/net/schema';
import { ROTATION_2, ROTATION_4 } from '../src/net/schema';
import {
  GIFT_MS as CLIENT_GIFT_MS,
  RESERVE_MS as CLIENT_RESERVE_MS,
  giftUpdate,
  moveUpdate,
  offerFields,
  startUpdate,
  swapSettleUpdate,
  timeoutUpdate,
} from '../src/net/writes';

const GID = 'ROOM42';
const SECRET = 'a-secret-of-sufficient-length-01';

// Restated here rather than imported from rules/build.mjs, so that a change to
// either side of the client/rules pair fails a test instead of quietly
// agreeing with itself. The last test in each suite below asserts the match.
const GRACE_MS = 25000;
const RESERVE_MS = 2000;
const GIFT_MS = 15000;

const UID: Record<Slot, string> = {
  P1: 'uid-p1',
  P2: 'uid-p2',
  P3: 'uid-p3',
  P4: 'uid-p4',
};

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-consultation-chess',
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: readFileSync('database.rules.json', 'utf8'),
    },
  });
});

afterAll(async () => env?.cleanup());
beforeEach(async () => env.clearDatabase());

/** A database handle authenticated as one seat's holder. */
function as(slot: Slot): Database {
  return env.authenticatedContext(UID[slot]).database() as unknown as Database;
}
function asStranger(): Database {
  return env.authenticatedContext('uid-nobody').database() as unknown as Database;
}
function asAnon(): Database {
  return env.unauthenticatedContext().database() as unknown as Database;
}

interface SeedOptions {
  seats?: 2 | 4;
  status?: NetGame['status'];
  clocks?: { w: number; b: number };
  /** The seat on move. Defaults to P1, the start of the rotation. */
  toMove?: Slot;
  /** Seats to fill. Defaults to every seat the rotation uses. */
  fill?: Slot[];
  lastMoveAt?: number;
  offer?: NetGame['offer'];
  secrets?: Partial<Record<Slot, string>>;
  /** Live seat holds, as `reserve/$slot`. `at` is relative to now, in ms. */
  reserve?: Partial<Record<Slot, { uid: string; at: number }>>;
}

/** Plant a game directly, bypassing rules — the fixture, not the thing tested. */
async function seed(options: SeedOptions = {}): Promise<NetGame> {
  const seats = options.seats ?? 4;
  const rotation = seats === 2 ? ROTATION_2 : ROTATION_4;
  const order = Object.keys(rotation) as Slot[];
  const fill = options.fill ?? order;
  const now = Date.now();

  // A seat on move must be seated behind a position whose side to move matches
  // its army, or the rules layer rejects the move before the security rules
  // are ever consulted. Black seats get the position after 1.e4.
  const onMove = options.toMove ?? 'P1';
  const fen =
    onMove === 'P3' || onMove === 'P4'
      ? 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
      : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const game: NetGame = {
    fen,
    // The client rules layer derives whose turn it is from `turnIndex`, so a
    // seeded `toMove` has to agree with it or `moveUpdate` refuses the move
    // before any of this reaches the database.
    turnIndex: order.indexOf(onMove),
    toMove: onMove,
    rotation,
    seats,
    clocks: options.clocks ?? { w: 600000, b: 600000 },
    initialClock: 600000,
    lastMoveAt: options.lastMoveAt ?? now,
    status: options.status ?? 'active',
    result: null,
    createdAt: now,
    players: Object.fromEntries(
      fill.map((slot) => [
        slot,
        { uid: UID[slot], connected: true, lastSeen: now },
      ]),
    ),
    ...(options.offer ? { offer: options.offer } : {}),
    ...(options.reserve
      ? {
          reserve: Object.fromEntries(
            Object.entries(options.reserve).map(([slot, hold]) => [
              slot,
              { uid: hold.uid, at: now + hold.at },
            ]),
          ),
        }
      : {}),
  } as NetGame;

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database() as unknown as Database;
    await set(ref(db, `games/${GID}`), game);
    if (options.secrets) {
      await set(ref(db, `secrets/${GID}`), options.secrets);
    }
  });
  return game;
}

/** The exact update the app would send for a move, with a fresh push key. */
function move(game: NetGame, from: string, to: string, db: Database) {
  const key = push(child(ref(db, `games/${GID}`), 'moves')).key!;
  const built = moveUpdate(game, { from, to }, key, Date.now());
  if (!built.ok) throw new Error(built.reason);
  return built.update;
}

// ---------------------------------------------------------------------------

describe('reading', () => {
  it('lets any signed-in player watch a game by its room code', async () => {
    await seed();
    await assertSucceeds(get(ref(as('P1'), `games/${GID}`)));
    await assertSucceeds(get(ref(asStranger(), `games/${GID}`)));
  });

  it('refuses an unauthenticated reader', async () => {
    await seed();
    await assertFails(get(ref(asAnon(), `games/${GID}`)));
  });

  it('never exposes a slot secret, to anyone, at any depth', async () => {
    await seed({ secrets: { P1: SECRET } });
    await assertFails(get(ref(as('P1'), `secrets/${GID}/P1`)));
    await assertFails(get(ref(as('P1'), `secrets/${GID}`)));
    await assertFails(get(ref(as('P1'), 'secrets')));
  });

  it('shows why secrets cannot live under the game node', async () => {
    await seed({ secrets: { P1: SECRET } });
    // A read grant cascades downward and no child rule can revoke it, so this
    // path is readable by everyone in the room. It comes back empty only
    // because the secrets are stored elsewhere — a `.read: false` sitting here
    // would not have helped, which is the whole reason for the split.
    const snap = await assertSucceeds(get(ref(as('P1'), `games/${GID}/secrets`)));
    expect(snap.val()).toBe(null);
  });

  it('never exposes the proof node either', async () => {
    await seed();
    await assertFails(get(ref(as('P1'), `proof/${GID}/${UID.P1}/P1`)));
  });
});

describe('the turn gate', () => {
  it('lets the seat on move play', async () => {
    const game = await seed();
    const db = as('P1');
    await assertSucceeds(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
  });

  it('refuses a teammate who shares the army but is not on move', async () => {
    const game = await seed();
    // P2 commands white too, and e4 is perfectly legal. It is not P2's turn.
    const db = as('P2');
    await assertFails(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
  });

  it('refuses an opponent', async () => {
    const game = await seed();
    const db = as('P3');
    await assertFails(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
  });

  it('refuses a stranger who is in no seat at all', async () => {
    const game = await seed();
    const db = asStranger();
    await assertFails(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
  });

  it('refuses a move while the game is still in the lobby', async () => {
    const game = await seed({ status: 'lobby' });
    const db = as('P1');
    const key = push(child(ref(db, `games/${GID}`), 'moves')).key!;
    const built = moveUpdate({ ...game, status: 'active' }, { from: 'e2', to: 'e4' }, key, Date.now());
    if (!built.ok) throw new Error(built.reason);
    await assertFails(update(ref(db, `games/${GID}`), built.update));
  });

  it('refuses a move once the game is over', async () => {
    const game = await seed({ status: 'checkmate' });
    const db = as('P1');
    const key = push(child(ref(db, `games/${GID}`), 'moves')).key!;
    const built = moveUpdate({ ...game, status: 'active' }, { from: 'e2', to: 'e4' }, key, Date.now());
    if (!built.ok) throw new Error(built.reason);
    await assertFails(update(ref(db, `games/${GID}`), built.update));
  });
});

describe('the turnIndex assertion', () => {
  it('refuses a turnIndex that skips ahead', async () => {
    const game = await seed();
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    u['turnIndex'] = 2;
    await assertFails(update(ref(db, `games/${GID}`), u));
  });

  it('refuses a turnIndex that stands still — the losing racer', async () => {
    const game = await seed();
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    u['turnIndex'] = 0;
    await assertFails(update(ref(db, `games/${GID}`), u));
  });

  it('refuses a turnIndex that goes backwards', async () => {
    const game = await seed();
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    u['turnIndex'] = -1;
    await assertFails(update(ref(db, `games/${GID}`), u));
  });

  it('makes two clients racing the same turn mutually exclusive', async () => {
    const game = await seed();
    const p1 = as('P1');
    const first = move(game, 'e2', 'e4', p1);
    const second = move(game, 'd2', 'd4', p1);
    await assertSucceeds(update(ref(p1, `games/${GID}`), first));
    // The second was composed against turnIndex 0 and is now stale, exactly as
    // a concurrent write from another device would be.
    await assertFails(update(ref(p1, `games/${GID}`), second));
  });

  it('refuses a board change that does not advance the turn at all', async () => {
    await seed();
    const db = as('P1');
    await assertFails(
      set(ref(db, `games/${GID}/fen`), '8/8/8/8/8/8/8/K6k w - - 0 1'),
    );
  });
});

describe('the move log', () => {
  it('refuses a successor seat that is not the one the rotation names', async () => {
    const game = await seed();
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    u['toMove'] = 'P2'; // white again; the rotation says P3
    await assertFails(update(ref(db, `games/${GID}`), u));
  });

  it('refuses a log entry attributed to another seat', async () => {
    const game = await seed();
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    const key = Object.keys(u).find((k) => k.startsWith('moves/'))!;
    (u[key] as Record<string, unknown>)['by'] = 'P2';
    await assertFails(update(ref(db, `games/${GID}`), u));
  });

  it('refuses a log entry whose position disagrees with the cached fen', async () => {
    const game = await seed();
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    const key = Object.keys(u).find((k) => k.startsWith('moves/'))!;
    (u[key] as Record<string, unknown>)['fenAfter'] = '8/8/8/8/8/8/8/K6k b - - 0 1';
    await assertFails(update(ref(db, `games/${GID}`), u));
  });

  it('refuses an unknown field smuggled into a log entry', async () => {
    const game = await seed();
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    const key = Object.keys(u).find((k) => k.startsWith('moves/'))!;
    (u[key] as Record<string, unknown>)['note'] = 'hello';
    await assertFails(update(ref(db, `games/${GID}`), u));
  });

  it('is append-only: a written move can never be edited', async () => {
    const game = await seed();
    const db = as('P1');
    await assertSucceeds(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
    const snap = await get(ref(as('P1'), `games/${GID}/moves`));
    const key = Object.keys(snap.val())[0]!;
    await assertFails(set(ref(db, `games/${GID}/moves/${key}/san`), 'Qxf7#'));
  });

  it('is append-only: a written move can never be deleted', async () => {
    const game = await seed();
    const db = as('P1');
    await assertSucceeds(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
    const snap = await get(ref(as('P1'), `games/${GID}/moves`));
    const key = Object.keys(snap.val())[0]!;
    await assertFails(set(ref(db, `games/${GID}/moves/${key}`), null));
    await assertFails(set(ref(db, `games/${GID}/moves`), null));
  });

  it('refuses a backdated move timestamp', async () => {
    const game = await seed();
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    const key = Object.keys(u).find((k) => k.startsWith('moves/'))!;
    (u[key] as Record<string, unknown>)['ts'] = Date.now() - 600000;
    await assertFails(update(ref(db, `games/${GID}`), u));
  });

  it('refuses a backdated lastMoveAt, which would refund the clock', async () => {
    const game = await seed();
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    u['lastMoveAt'] = Date.now() - 600000;
    await assertFails(update(ref(db, `games/${GID}`), u));
  });
});

describe('clocks', () => {
  it('accepts a decrement that matches the elapsed time', async () => {
    const game = await seed({ lastMoveAt: Date.now() - 5000 });
    const db = as('P1');
    await assertSucceeds(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
    const snap = await get(ref(as('P1'), `games/${GID}/clocks/w`));
    expect(snap.val()).toBeLessThan(600000);
  });

  it('refuses a clock that gains time', async () => {
    const game = await seed();
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    u['clocks/w'] = 900000;
    await assertFails(update(ref(db, `games/${GID}`), u));
  });

  it('refuses draining the opponent clock instead of your own', async () => {
    const game = await seed({ lastMoveAt: Date.now() - 5000 });
    const db = as('P1');
    const u = move(game, 'e2', 'e4', db);
    delete u['clocks/w'];
    u['clocks/b'] = 100;
    await assertFails(update(ref(db, `games/${GID}`), u));
  });

  it('refuses a clock write outside a turn advance', async () => {
    await seed();
    const db = as('P1');
    await assertFails(set(ref(db, `games/${GID}/clocks/w`), 900000));
  });
});

describe('calling the flag', () => {
  it('refuses a timeout while the side on move still has time', async () => {
    const game = await seed({ clocks: { w: 600000, b: 600000 } });
    const db = as('P3');
    await assertFails(update(ref(db, `games/${GID}`), timeoutUpdate(game)));
  });

  it('allows a timeout once the elapsed time exceeds the clock', async () => {
    const game = await seed({ clocks: { w: 1000, b: 600000 }, lastMoveAt: Date.now() - 5000 });
    const db = as('P3');
    await assertSucceeds(update(ref(db, `games/${GID}`), timeoutUpdate(game)));
  });

  it('refuses a timeout called by a stranger', async () => {
    const game = await seed({ clocks: { w: 1000, b: 600000 }, lastMoveAt: Date.now() - 5000 });
    await assertFails(update(ref(asStranger(), `games/${GID}`), timeoutUpdate(game)));
  });
});

describe('seats and secrets', () => {
  it('lets a player claim an empty seat and then mint its secret', async () => {
    await seed({ status: 'lobby', fill: [] });
    const db = as('P1');
    await assertSucceeds(
      set(ref(db, `games/${GID}/players/P1`), {
        uid: UID.P1,
        connected: true,
        lastSeen: Date.now(),
      }),
    );
    await assertSucceeds(set(ref(db, `secrets/${GID}/P1`), SECRET));
  });

  it('refuses a claim on an occupied seat', async () => {
    await seed({ status: 'lobby', fill: ['P1'], secrets: { P1: SECRET } });
    await assertFails(
      set(ref(asStranger(), `games/${GID}/players/P1`), {
        uid: 'uid-nobody',
        connected: true,
        lastSeen: Date.now(),
      }),
    );
  });

  it('refuses minting a secret for a seat you do not hold', async () => {
    await seed({ status: 'lobby', fill: ['P1'] });
    await assertFails(set(ref(asStranger(), `secrets/${GID}/P1`), SECRET));
  });

  // A secret used to be write-once. It is now replaceable BY ITS HOLDER, which
  // is what lets a player swapped into a seat take ownership of it — the seat
  // they moved into already had somebody else's secret on it. The protection
  // that matters is unchanged and asserted just above and just below: only the
  // current holder can write it at all, and holding a seat means you either
  // found it empty or proved this very secret.
  it('lets the seat holder replace their own secret', async () => {
    await seed({ status: 'lobby', fill: ['P1'], secrets: { P1: SECRET } });
    await assertSucceeds(
      set(ref(as('P1'), `secrets/${GID}/P1`), 'a-different-secret-value-here'),
    );
  });

  it('refuses replacing the secret of a seat somebody else holds', async () => {
    await seed({ status: 'lobby', fill: ['P1'], secrets: { P1: SECRET } });
    await assertFails(
      set(ref(as('P3'), `secrets/${GID}/P1`), 'a-different-secret-value-here'),
    );
  });

  it('lets the original player reclaim their seat from a new uid with the secret', async () => {
    await seed({ status: 'lobby', fill: ['P1'], secrets: { P1: SECRET } });
    // The same person, back in an incognito window: a brand new anonymous uid.
    const reborn = env.authenticatedContext('uid-p1-incognito').database() as unknown as Database;
    await assertSucceeds(set(ref(reborn, `proof/${GID}/uid-p1-incognito/P1`), SECRET));
    await assertSucceeds(
      set(ref(reborn, `games/${GID}/players/P1`), {
        uid: 'uid-p1-incognito',
        connected: true,
        lastSeen: Date.now(),
      }),
    );
  });

  it('refuses a reclaim with the wrong secret', async () => {
    await seed({ status: 'lobby', fill: ['P1'], secrets: { P1: SECRET } });
    const thief = env.authenticatedContext('uid-thief').database() as unknown as Database;
    await assertSucceeds(set(ref(thief, `proof/${GID}/uid-thief/P1`), 'wrong-secret-but-long-enough'));
    await assertFails(
      set(ref(thief, `games/${GID}/players/P1`), {
        uid: 'uid-thief',
        connected: true,
        lastSeen: Date.now(),
      }),
    );
  });

  it('refuses a reclaim that writes proof under somebody else’s uid', async () => {
    await seed({ status: 'lobby', fill: ['P1'], secrets: { P1: SECRET } });
    await assertFails(set(ref(asStranger(), `proof/${GID}/${UID.P1}/P1`), SECRET));
  });

  it('refuses claiming a seat under another player’s uid', async () => {
    await seed({ status: 'lobby', fill: [] });
    await assertFails(
      set(ref(as('P1'), `games/${GID}/players/P1`), {
        uid: UID.P3,
        connected: true,
        lastSeen: Date.now(),
      }),
    );
  });

  it('lets a seat holder update their own presence', async () => {
    await seed();
    await assertSucceeds(set(ref(as('P1'), `games/${GID}/players/P1/connected`), false));
  });

  it('refuses marking somebody else as disconnected', async () => {
    await seed();
    await assertFails(set(ref(as('P3'), `games/${GID}/players/P1/connected`), false));
  });
});

describe('starting the game', () => {
  // Three players is a real table, not a broken one: black plays a man down and
  // P4 stays open for anyone who turns up later.
  it('starts a four-seat game with one seat still empty', async () => {
    await seed({ status: 'lobby', fill: ['P1', 'P3', 'P2'] });
    await assertSucceeds(update(ref(as('P1'), `games/${GID}`), startUpdate()));
  });

  it('refuses to start with an army that has nobody in it', async () => {
    await seed({ status: 'lobby', fill: ['P1', 'P2'] });
    await assertFails(update(ref(as('P1'), `games/${GID}`), startUpdate()));
  });

  it('starts once every seat is taken', async () => {
    await seed({ status: 'lobby' });
    await assertSucceeds(update(ref(as('P1'), `games/${GID}`), startUpdate()));
  });

  it('needs only two seats in a two-seat game', async () => {
    await seed({ seats: 2, status: 'lobby' });
    await assertSucceeds(update(ref(as('P1'), `games/${GID}`), startUpdate()));
  });

  it('refuses a start called by somebody with no seat', async () => {
    await seed({ status: 'lobby' });
    await assertFails(update(ref(asStranger(), `games/${GID}`), startUpdate()));
  });
});

describe('teammate takeover', () => {
  async function seedAbsent(sinceMs: number) {
    const game = await seed();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.database() as unknown as Database;
      await update(ref(db, `games/${GID}/players/P1`), {
        connected: false,
        lastSeen: Date.now() - sinceMs,
      });
    });
    return game;
  }

  it('refuses a takeover inside the grace period', async () => {
    const game = await seedAbsent(GRACE_MS / 2);
    const db = as('P2');
    await assertFails(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
  });

  it('allows the teammate to play the absent seat once grace lapses', async () => {
    const game = await seedAbsent(GRACE_MS + 5000);
    const db = as('P2');
    // The move is still attributed to P1 — the seat moved, not the person.
    await assertSucceeds(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
  });

  it('does not let an opponent take over an absent seat', async () => {
    const game = await seedAbsent(GRACE_MS + 5000);
    const db = as('P3');
    await assertFails(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
  });

  it('has no takeover in a two-seat game, however long the absence', async () => {
    const game = await seed({ seats: 2 });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.database() as unknown as Database;
      await update(ref(db, `games/${GID}/players/P1`), {
        connected: false,
        lastSeen: Date.now() - GRACE_MS * 4,
      });
    });
    const db = as('P3');
    await assertFails(update(ref(db, `games/${GID}`), move(game, 'e2', 'e4', db)));
  });
});

describe('consent', () => {
  const offer = (kind: 'resign' | 'draw', by: Slot, accept: Partial<Record<Slot, boolean>>) =>
    ({ kind, army: by === 'P1' || by === 'P2' ? 'w' : 'b', by, at: Date.now(), accept }) as const;

  it('lets a seated player open an offer', async () => {
    await seed();
    await assertSucceeds(update(ref(as('P1'), `games/${GID}`), offerFields('draw', 'P1')));
  });

  it('refuses an offer from someone with no seat', async () => {
    await seed();
    await assertFails(update(ref(asStranger(), `games/${GID}`), offerFields('draw', 'P1')));
  });

  it('refuses accepting on another seat’s behalf', async () => {
    await seed({ offer: offer('resign', 'P1', {}) });
    await assertFails(set(ref(as('P1'), `games/${GID}/offer/accept/P2`), true));
  });

  it('refuses a resignation with only one teammate agreeing', async () => {
    const game = await seed({ offer: offer('resign', 'P1', { P1: true }) });
    await assertFails(
      update(ref(as('P1'), `games/${GID}`), { status: 'resigned', result: '0-1' }),
    );
    expect(game.seats).toBe(4);
  });

  it('allows a resignation once the whole army has agreed', async () => {
    await seed({ offer: offer('resign', 'P1', { P1: true, P2: true }) });
    await assertSucceeds(
      update(ref(as('P1'), `games/${GID}`), { status: 'resigned', result: '0-1' }),
    );
  });

  it('refuses a resignation that awards the game to the resigning side', async () => {
    await seed({ offer: offer('resign', 'P1', { P1: true, P2: true }) });
    await assertFails(
      update(ref(as('P1'), `games/${GID}`), { status: 'resigned', result: '1-0' }),
    );
  });

  it('refuses a draw until every seat has accepted', async () => {
    await seed({ offer: offer('draw', 'P1', { P1: true, P2: true, P3: true }) });
    await assertFails(
      update(ref(as('P1'), `games/${GID}`), { status: 'draw', result: '1/2-1/2' }),
    );
  });

  it('allows a draw when all four have accepted', async () => {
    await seed({ offer: offer('draw', 'P1', { P1: true, P2: true, P3: true, P4: true }) });
    await assertSucceeds(
      update(ref(as('P1'), `games/${GID}`), { status: 'draw', result: '1/2-1/2' }),
    );
  });

  it('needs one acceptance per army in a two-seat game', async () => {
    await seed({ seats: 2, offer: offer('resign', 'P1', { P1: true }) });
    await assertSucceeds(
      update(ref(as('P1'), `games/${GID}`), { status: 'resigned', result: '0-1' }),
    );
  });

  it('lets any seated player clear a pending offer', async () => {
    await seed({ offer: offer('draw', 'P1', { P1: true }) });
    await assertSucceeds(
      update(ref(as('P3'), `games/${GID}`), {
        'offer/kind': null,
        'offer/army': null,
        'offer/by': null,
        'offer/at': null,
        'offer/accept/P1': null,
      }),
    );
  });
});

describe('the game node itself', () => {
  it('lets a signed-in player create a game', async () => {
    await assertSucceeds(
      set(ref(as('P1'), `games/NEWONE`), {
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        turnIndex: 0,
        toMove: 'P1',
        rotation: ROTATION_4,
        seats: 4,
        clocks: { w: 600000, b: 600000 },
        initialClock: 600000,
        status: 'lobby',
        createdAt: { '.sv': 'timestamp' },
      }),
    );
  });

  it('refuses a game missing required fields', async () => {
    await assertFails(set(ref(as('P1'), `games/NEWONE`), { fen: 'x', status: 'lobby' }));
  });

  it('refuses overwriting an existing game wholesale', async () => {
    await seed();
    await assertFails(
      set(ref(as('P1'), `games/${GID}`), {
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        turnIndex: 0,
        toMove: 'P1',
        rotation: ROTATION_4,
        seats: 4,
        clocks: { w: 600000, b: 600000 },
        initialClock: 600000,
        status: 'lobby',
        createdAt: { '.sv': 'timestamp' },
      }),
    );
  });

  it('refuses deleting a game', async () => {
    await seed();
    await assertFails(set(ref(as('P1'), `games/${GID}`), null));
  });

  it('refuses an unknown top-level field on a game', async () => {
    await seed();
    await assertFails(set(ref(as('P1'), `games/${GID}/backdoor`), true));
  });

  it('refuses writes anywhere outside the three known roots', async () => {
    await assertFails(set(ref(as('P1'), 'somewhere/else'), true));
  });
});

// ---------------------------------------------------------------------------
// Playing a man down, trading seats, holding a seat, handing over time.
// ---------------------------------------------------------------------------

describe('playing a man down', () => {
  it('lets the lone teammate play an empty seat at once, with no grace period', async () => {
    // P1, P2 and P3 are seated; P4 never turned up. When the rotation reaches
    // P4 the seat is nobody's, so P3 — the rest of black — plays it.
    const game = await seed({ fill: ['P1', 'P2', 'P3'], toMove: 'P4' });
    await assertSucceeds(
      update(ref(as('P3'), `games/${GID}`), move(game, 'e7', 'e5', as('P3'))),
    );
  });

  it('still refuses an opponent playing the empty seat', async () => {
    const game = await seed({ fill: ['P1', 'P2', 'P3'], toMove: 'P4' });
    await assertFails(
      update(ref(as('P1'), `games/${GID}`), move(game, 'e7', 'e5', as('P1'))),
    );
  });

  it('still refuses a stranger playing the empty seat', async () => {
    const game = await seed({ fill: ['P1', 'P2', 'P3'], toMove: 'P4' });
    await assertFails(
      update(ref(asStranger(), `games/${GID}`), move(game, 'e7', 'e5', asStranger())),
    );
  });

  it('lets a short-handed army resign without the empty seat’s signature', async () => {
    await seed({
      fill: ['P1', 'P2', 'P3'],
      offer: { kind: 'resign', army: 'b', by: 'P3', at: Date.now(), accept: { P3: true } },
    });
    await assertSucceeds(
      update(ref(as('P3'), `games/${GID}`), { status: 'resigned', result: '1-0' }),
    );
  });

  it('refuses a resignation signed by nobody at all', async () => {
    // Both black seats empty. There is no army left to agree to anything, and
    // `armyManned` is what stops the empty-seat shortcut collapsing into that.
    await seed({
      fill: ['P1', 'P2'],
      offer: { kind: 'resign', army: 'b', by: 'P3', at: Date.now(), accept: {} },
    });
    await assertFails(
      update(ref(as('P1'), `games/${GID}`), { status: 'resigned', result: '1-0' }),
    );
  });
});

describe('leaving a seat', () => {
  it('lets a player vacate their own seat, secret and all', async () => {
    await seed({ status: 'lobby', fill: ['P1', 'P3'], secrets: { P1: SECRET } });
    await assertSucceeds(
      update(ref(as('P1')), {
        [`games/${GID}/players/P1`]: null,
        [`secrets/${GID}/P1`]: null,
      }),
    );
  });

  it('refuses vacating somebody else’s seat', async () => {
    await seed({ status: 'lobby', fill: ['P1', 'P3'] });
    await assertFails(set(ref(as('P3'), `games/${GID}/players/P1`), null));
  });

  it('refuses a stranger vacating a seat', async () => {
    await seed({ status: 'lobby', fill: ['P1', 'P3'] });
    await assertFails(set(ref(asStranger(), `games/${GID}/players/P1`), null));
  });

  it('leaves a vacated seat claimable by the next player', async () => {
    await seed({ status: 'lobby', fill: ['P3'] });
    await assertSucceeds(
      set(ref(asStranger(), `games/${GID}/players/P1`), {
        uid: 'uid-nobody',
        connected: true,
        lastSeen: Date.now(),
      }),
    );
  });

  // Why vacating clears the secret in the same update. This asserts the trap
  // rather than the feature: a seat left with its secret on it is a seat
  // nobody — including the player who just left it — can ever sit in again.
  it('shows why the secret must leave with the player', async () => {
    await seed({ status: 'lobby', fill: [], secrets: { P1: SECRET } });
    await assertFails(
      set(ref(asStranger(), `games/${GID}/players/P1`), {
        uid: 'uid-nobody',
        connected: true,
        lastSeen: Date.now(),
      }),
    );
  });
});

describe('holding a seat while you take it', () => {
  const hold = (uid: string) => ({ uid, at: { '.sv': 'timestamp' } });
  const sit = (uid: string) => ({ uid, connected: true, lastSeen: Date.now() });

  it('lets a player hold an empty seat', async () => {
    await seed({ status: 'lobby', fill: [] });
    await assertSucceeds(set(ref(as('P1'), `games/${GID}/reserve/P1`), hold(UID.P1)));
  });

  it('blocks another player from claiming a seat under a live hold', async () => {
    await seed({ status: 'lobby', fill: [], reserve: { P1: { uid: UID.P1, at: 0 } } });
    await assertFails(set(ref(as('P3'), `games/${GID}/players/P1`), sit(UID.P3)));
  });

  it('lets the holder claim through their own hold', async () => {
    await seed({ status: 'lobby', fill: [], reserve: { P1: { uid: UID.P1, at: 0 } } });
    await assertSucceeds(set(ref(as('P1'), `games/${GID}/players/P1`), sit(UID.P1)));
  });

  it('blocks nobody once the hold has expired', async () => {
    await seed({
      status: 'lobby',
      fill: [],
      reserve: { P1: { uid: UID.P1, at: -RESERVE_MS - 1000 } },
    });
    await assertSucceeds(set(ref(as('P3'), `games/${GID}/players/P1`), sit(UID.P3)));
  });

  it('refuses taking over a hold somebody else is still using', async () => {
    await seed({ status: 'lobby', fill: [], reserve: { P1: { uid: UID.P1, at: 0 } } });
    await assertFails(set(ref(as('P3'), `games/${GID}/reserve/P1`), hold(UID.P3)));
  });

  it('refuses holding a seat somebody is sitting in', async () => {
    await seed({ status: 'lobby', fill: ['P1'] });
    await assertFails(set(ref(as('P3'), `games/${GID}/reserve/P1`), hold(UID.P3)));
  });

  it('refuses a hold under another player’s uid', async () => {
    await seed({ status: 'lobby', fill: [] });
    await assertFails(set(ref(as('P1'), `games/${GID}/reserve/P1`), hold(UID.P3)));
  });

  it('refuses a post-dated hold, which would outlast its window', async () => {
    await seed({ status: 'lobby', fill: [] });
    await assertFails(
      set(ref(as('P1'), `games/${GID}/reserve/P1`), { uid: UID.P1, at: Date.now() + 60000 }),
    );
  });

  it('refuses releasing somebody else’s hold', async () => {
    await seed({ status: 'lobby', fill: [], reserve: { P1: { uid: UID.P1, at: 0 } } });
    await assertFails(set(ref(as('P3'), `games/${GID}/reserve/P1`), null));
  });

  it('keeps the hold window in step with the client', () => {
    expect(RESERVE_MS).toBe(CLIENT_RESERVE_MS);
  });
});

describe('trading seats', () => {
  const agreed = {
    kind: 'swap' as const,
    army: 'w' as const,
    by: 'P1' as const,
    with: 'P3' as const,
  };
  const signed = { P1: true, P3: true };

  it('swaps two seats once both have signed', async () => {
    const game = await seed({
      status: 'lobby',
      offer: { ...agreed, at: Date.now(), accept: signed },
    });
    await assertSucceeds(
      update(ref(as('P1'), `games/${GID}`), swapSettleUpdate(game, game.offer!)!),
    );
  });

  it('lets the other party settle it just as well', async () => {
    const game = await seed({
      status: 'lobby',
      offer: { ...agreed, at: Date.now(), accept: signed },
    });
    await assertSucceeds(
      update(ref(as('P3'), `games/${GID}`), swapSettleUpdate(game, game.offer!)!),
    );
  });

  it('refuses a swap with only one signature', async () => {
    const game = await seed({
      status: 'lobby',
      offer: { ...agreed, at: Date.now(), accept: { P1: true } },
    });
    await assertFails(
      update(ref(as('P1'), `games/${GID}`), swapSettleUpdate(game, game.offer!)!),
    );
  });

  it('refuses a swap with no offer open at all', async () => {
    await seed({ status: 'lobby' });
    await assertFails(
      update(ref(as('P1'), `games/${GID}`), {
        'players/P1': { uid: UID.P3, connected: true, lastSeen: Date.now() },
        'players/P3': { uid: UID.P1, connected: true, lastSeen: Date.now() },
      }),
    );
  });

  // The grant is "put the counterpart's uid here", not "put anybody here".
  it('refuses smuggling an unrelated uid in under an agreed swap', async () => {
    await seed({
      status: 'lobby',
      offer: { ...agreed, at: Date.now(), accept: signed },
    });
    await assertFails(
      update(ref(as('P1'), `games/${GID}`), {
        'players/P1': { uid: 'uid-nobody', connected: true, lastSeen: Date.now() },
        'players/P3': { uid: UID.P1, connected: true, lastSeen: Date.now() },
      }),
    );
  });

  it('refuses dragging in a seat the offer does not name', async () => {
    await seed({
      status: 'lobby',
      offer: { ...agreed, at: Date.now(), accept: signed },
    });
    await assertFails(
      set(ref(as('P1'), `games/${GID}/players/P2`), {
        uid: UID.P4,
        connected: true,
        lastSeen: Date.now(),
      }),
    );
  });

  it('refuses a swap once the clocks are running', async () => {
    const game = await seed({
      status: 'active',
      offer: { ...agreed, at: Date.now(), accept: signed },
    });
    await assertFails(
      update(ref(as('P1'), `games/${GID}`), swapSettleUpdate(game, game.offer!)!),
    );
  });

  it('refuses a swap settled by somebody with no seat', async () => {
    const game = await seed({
      status: 'lobby',
      offer: { ...agreed, at: Date.now(), accept: signed },
    });
    await assertFails(
      update(ref(asStranger(), `games/${GID}`), swapSettleUpdate(game, game.offer!)!),
    );
  });

  it('refuses signing the swap on the other seat’s behalf', async () => {
    await seed({
      status: 'lobby',
      offer: { ...agreed, at: Date.now(), accept: { P1: true } },
    });
    await assertFails(set(ref(as('P1'), `games/${GID}/offer/accept/P3`), true));
  });
});

describe('handing the other team fifteen seconds', () => {
  const evenClocks = { w: 600000, b: 600000 };

  it('lets a black seat add exactly fifteen seconds to the white clock', async () => {
    const game = await seed({ clocks: evenClocks });
    await assertSucceeds(update(ref(as('P3'), `games/${GID}`), giftUpdate(game, 'w')));
  });

  it('lets a white seat do the same for black', async () => {
    const game = await seed({ clocks: evenClocks });
    await assertSucceeds(update(ref(as('P1'), `games/${GID}`), giftUpdate(game, 'b')));
  });

  it('refuses a gift to your own army', async () => {
    const game = await seed({ clocks: evenClocks });
    await assertFails(update(ref(as('P1'), `games/${GID}`), giftUpdate(game, 'w')));
  });

  it('refuses an amount that is not fifteen seconds', async () => {
    await seed({ clocks: evenClocks });
    await assertFails(
      update(ref(as('P3'), `games/${GID}`), { 'clocks/w': 600000 + 60000 }),
    );
  });

  it('refuses a gift from somebody with no seat', async () => {
    const game = await seed({ clocks: evenClocks });
    await assertFails(update(ref(asStranger(), `games/${GID}`), giftUpdate(game, 'w')));
  });

  it('refuses a gift once the game is over', async () => {
    const game = await seed({ status: 'checkmate', clocks: evenClocks });
    await assertFails(update(ref(as('P3'), `games/${GID}`), giftUpdate(game, 'w')));
  });

  /**
   * The precedence trap, asserted directly. If the gift branch of the clock
   * validate were not pinned to "not a turn advance", a mover could bolt +15s
   * onto their OWN clock while playing a legal move, and the decrement window
   * — the whole reason clocks are validated — would be bypassed every turn.
   */
  it('refuses a mover bolting fifteen seconds onto their own clock', async () => {
    const game = await seed({ clocks: evenClocks });
    const cheat = move(game, 'e2', 'e4', as('P1'));
    cheat['clocks/w'] = game.clocks.w + GIFT_MS;
    await assertFails(update(ref(as('P1'), `games/${GID}`), cheat));
  });

  it('keeps the gift in step with the client', () => {
    expect(GIFT_MS).toBe(CLIENT_GIFT_MS);
  });
});
