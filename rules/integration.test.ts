/**
 * A whole game, end to end, through the same functions the app calls.
 *
 * The rules suite next door asserts that attacks fail. This one asserts that
 * the legitimate sequence actually succeeds — four seats claimed, a rotation
 * that alternates armies, a disconnect covered by a teammate, a seat reclaimed
 * from a new identity, and a game ended by consent.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { child, get, push, ref, set, update } from 'firebase/database';
import type { Database } from 'firebase/database';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Slot } from '../src/game/types';
import type { NetGame } from '../src/net/schema';
import { ROTATION_4, seatsOf, toGameState } from '../src/net/schema';
import { toPgn } from '../src/game/derive';
import {
  clearOfferUpdate,
  consentComplete,
  moveUpdate,
  newGameNode,
  offerFields,
  settleOfferUpdate,
  startUpdate,
} from '../src/net/writes';

const GID = 'PLAY1';
const SEATS: Slot[] = ['P1', 'P3', 'P2', 'P4'];
const UID: Record<Slot, string> = {
  P1: 'u1',
  P2: 'u2',
  P3: 'u3',
  P4: 'u4',
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

function db(uid: string): Database {
  return env.authenticatedContext(uid).database() as unknown as Database;
}

async function readGame(): Promise<NetGame> {
  const snap = await get(ref(db(UID.P1), `games/${GID}`));
  return snap.val() as NetGame;
}

/** Claim, then mint — the order src/net/seat.ts uses and rules require. */
async function sit(slot: Slot, secret: string) {
  const handle = db(UID[slot]);
  await assertSucceeds(
    set(ref(handle, `games/${GID}/players/${slot}`), {
      uid: UID[slot],
      name: slot,
      connected: true,
      lastSeen: Date.now(),
    }),
  );
  await assertSucceeds(set(ref(handle, `secrets/${GID}/${slot}`), secret));
}

/** Play one move as whoever the rotation says is up. */
async function playAs(uid: string, from: string, to: string) {
  const game = await readGame();
  const handle = db(uid);
  const key = push(child(ref(handle, `games/${GID}`), 'moves')).key!;
  const built = moveUpdate(game, { from, to }, key, Date.now());
  if (!built.ok) throw new Error(`${from}${to}: ${built.reason}`);
  return update(ref(handle, `games/${GID}`), built.update);
}

async function openTable() {
  await assertSucceeds(set(ref(db(UID.P1), `games/${GID}`), newGameNode(4, UID.P1)));
  for (const slot of SEATS) await sit(slot, `secret-for-${slot}-padded-out`);
  await assertSucceeds(update(ref(db(UID.P1), `games/${GID}`), startUpdate()));
}

describe('a four-seat game', () => {
  it('opens a table, seats everyone, and starts', async () => {
    await openTable();
    const game = await readGame();
    expect(game.status).toBe('active');
    expect(game.toMove).toBe('P1');
    expect(seatsOf(game)).toEqual(SEATS);
    expect(game.rotation).toEqual(ROTATION_4);
  });

  it('rotates through all four seats, alternating armies', async () => {
    await openTable();

    await assertSucceeds(playAs(UID.P1, 'e2', 'e4'));
    expect((await readGame()).toMove).toBe('P3');

    await assertSucceeds(playAs(UID.P3, 'e7', 'e5'));
    expect((await readGame()).toMove).toBe('P2');

    // P2 inherits the position P1 built — the point of consultation chess.
    await assertSucceeds(playAs(UID.P2, 'g1', 'f3'));
    expect((await readGame()).toMove).toBe('P4');

    await assertSucceeds(playAs(UID.P4, 'b8', 'c6'));

    const game = await readGame();
    expect(game.toMove).toBe('P1');
    expect(game.turnIndex).toBe(4);
    expect(toPgn(toGameState(game).moves, null)).toBe('1. e4 e5 2. Nf3 Nc6 *');
  });

  it('refuses a teammate playing a turn that is not theirs', async () => {
    await openTable();
    await assertSucceeds(playAs(UID.P1, 'e2', 'e4'));
    await assertSucceeds(playAs(UID.P3, 'e7', 'e5'));
    // The rotation is on P2 now. Nf3 is a perfectly legal white move and P1
    // commands white — but the turn belongs to the other white seat.
    await assertFails(playAs(UID.P1, 'g1', 'f3'));
  });

  it('drains only the moving army clock', async () => {
    await openTable();
    const before = await readGame();
    await assertSucceeds(playAs(UID.P1, 'e2', 'e4'));
    const after = await readGame();

    expect(after.clocks.w).toBeLessThanOrEqual(before.clocks.w);
    expect(after.clocks.b).toBe(before.clocks.b);
  });

  it('plays a full scholar’s mate and records the result', async () => {
    await openTable();
    // The mate falls on half-move seven, which lands on P2 — the teammate of
    // whoever developed the queen.
    await assertSucceeds(playAs(UID.P1, 'e2', 'e4'));
    await assertSucceeds(playAs(UID.P3, 'e7', 'e5'));
    await assertSucceeds(playAs(UID.P2, 'f1', 'c4'));
    await assertSucceeds(playAs(UID.P4, 'b8', 'c6'));
    await assertSucceeds(playAs(UID.P1, 'd1', 'h5'));
    await assertSucceeds(playAs(UID.P3, 'g8', 'f6'));
    await assertSucceeds(playAs(UID.P2, 'h5', 'f7'));

    const game = await readGame();
    expect(game.status).toBe('checkmate');
    expect(game.result).toBe('1-0');

    const state = toGameState(game);
    expect(state.moves[6]?.by).toBe('P2');
    expect(toPgn(state.moves, state.result)).toBe(
      '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0',
    );
  });

  it('refuses any further move once the game is over', async () => {
    await openTable();
    for (const [uid, from, to] of [
      [UID.P1, 'e2', 'e4'],
      [UID.P3, 'e7', 'e5'],
      [UID.P2, 'f1', 'c4'],
      [UID.P4, 'b8', 'c6'],
      [UID.P1, 'd1', 'h5'],
      [UID.P3, 'g8', 'f6'],
      [UID.P2, 'h5', 'f7'],
    ] as const) {
      await assertSucceeds(playAs(uid, from, to));
    }
    // The position is mate, so there is no legal move left to compose. What is
    // under test is the gate itself: nothing advances a finished game.
    const game = await readGame();
    await assertFails(
      update(ref(db(UID.P4), `games/${GID}`), { turnIndex: game.turnIndex + 1 }),
    );
  });
});

describe('coming back', () => {
  it('lets a player reclaim their seat from a completely new identity', async () => {
    await openTable();
    await assertSucceeds(playAs(UID.P1, 'e2', 'e4'));

    // P1 closes the tab; onDisconnect would have written this.
    await assertSucceeds(
      update(ref(db(UID.P1), `games/${GID}/players/P1`), {
        connected: false,
        lastSeen: Date.now(),
      }),
    );

    // P1 returns in a new browser: new anonymous uid, same ticket.
    const returning = 'u1-new-browser';
    const secret = 'secret-for-P1-padded-out';
    await assertSucceeds(set(ref(db(returning), `proof/${GID}/${returning}/P1`), secret));
    await assertSucceeds(
      set(ref(db(returning), `games/${GID}/players/P1`), {
        uid: returning,
        name: 'P1',
        connected: true,
        lastSeen: Date.now(),
      }),
    );

    // And can play again under the new uid.
    await assertSucceeds(playAs(UID.P3, 'e7', 'e5'));
    await assertSucceeds(playAs(UID.P2, 'g1', 'f3'));
    await assertSucceeds(playAs(UID.P4, 'b8', 'c6'));
    await assertSucceeds(playAs(returning, 'f1', 'c4'));

    expect((await readGame()).turnIndex).toBe(5);
  });

  it('lets a teammate play the absent seat once the grace period lapses', async () => {
    await openTable();

    await env.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.database() as unknown as Database;
      await update(ref(admin, `games/${GID}/players/P1`), {
        connected: false,
        lastSeen: Date.now() - 60000,
      });
    });

    // P2 plays P1's turn. The move is still attributed to the seat, not to P2.
    await assertSucceeds(playAs(UID.P2, 'e2', 'e4'));
    const game = await readGame();
    expect(game.moves && Object.values(game.moves)[0]?.by).toBe('P1');
    expect(game.toMove).toBe('P3');
  });
});

describe('ending by consent', () => {
  it('needs both white seats before white can resign', async () => {
    await openTable();

    // P1 proposes and signs in one write, exactly as the app does.
    await assertSucceeds(
      update(ref(db(UID.P1), `games/${GID}`), {
        ...offerFields('resign', 'P1'),
        'offer/accept/P1': true,
      }),
    );

    const pending = await readGame();
    const offer = pending.offer!;
    expect(consentComplete(pending, offer)).toBe(false);

    // P1 alone cannot finish it.
    await assertFails(
      update(ref(db(UID.P1), `games/${GID}`), settleOfferUpdate(offer)),
    );

    // P2 signs. This cannot also end the game: rules read consent from the
    // pre-write tree, where P2 has not agreed yet.
    await assertSucceeds(set(ref(db(UID.P2), `games/${GID}/offer/accept/P2`), true));

    const signed = await readGame();
    expect(consentComplete(signed, signed.offer!)).toBe(true);

    // The settling write is separate, and any seated player may make it.
    await assertSucceeds(
      update(ref(db(UID.P2), `games/${GID}`), {
        ...settleOfferUpdate(signed.offer!),
        ...clearOfferUpdate(seatsOf(signed)),
      }),
    );

    const done = await readGame();
    expect(done.status).toBe('resigned');
    expect(done.result).toBe('0-1');
    expect(done.offer ?? null).toBe(null);
  });

  it('needs every seat before a draw', async () => {
    await openTable();
    await assertSucceeds(
      update(ref(db(UID.P3), `games/${GID}`), {
        ...offerFields('draw', 'P3'),
        'offer/accept/P3': true,
      }),
    );
    for (const slot of ['P4', 'P1'] as Slot[]) {
      await assertSucceeds(
        set(ref(db(UID[slot]), `games/${GID}/offer/accept/${slot}`), true),
      );
    }

    const pending = await readGame();
    await assertFails(
      update(ref(db(UID.P1), `games/${GID}`), settleOfferUpdate(pending.offer!)),
    );

    await assertSucceeds(set(ref(db(UID.P2), `games/${GID}/offer/accept/P2`), true));

    const signed = await readGame();
    await assertSucceeds(
      update(ref(db(UID.P2), `games/${GID}`), {
        ...settleOfferUpdate(signed.offer!),
        ...clearOfferUpdate(seatsOf(signed)),
      }),
    );

    const done = await readGame();
    expect(done.status).toBe('draw');
    expect(done.result).toBe('1/2-1/2');
  });
});

describe('a two-seat game', () => {
  it('is the same game with a shorter rotation', async () => {
    await assertSucceeds(set(ref(db(UID.P1), `games/${GID}`), newGameNode(2, UID.P1)));
    await sit('P1', 'secret-for-P1-padded-out');
    await sit('P3', 'secret-for-P3-padded-out');
    await assertSucceeds(update(ref(db(UID.P1), `games/${GID}`), startUpdate()));

    await assertSucceeds(playAs(UID.P1, 'e2', 'e4'));
    await assertSucceeds(playAs(UID.P3, 'e7', 'e5'));
    await assertSucceeds(playAs(UID.P1, 'g1', 'f3'));

    const game = await readGame();
    expect(seatsOf(game)).toEqual(['P1', 'P3']);
    expect(game.toMove).toBe('P3');
    expect(game.turnIndex).toBe(3);
  });
});
