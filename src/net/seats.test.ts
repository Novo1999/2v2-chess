/**
 * The client half of short-handed play, seat holds, trades and time gifts.
 *
 * These mirror predicates that also exist in rules/build.mjs. The rules are the
 * security model and their own suite asserts them against the emulator; what is
 * asserted here is that the client agrees, because a client that disagrees
 * shows buttons the server will refuse.
 */

import { describe, expect, it } from 'vitest';
import type { NetGame, Offer } from './schema';
import {
  armyManned,
  canStart,
  emptySeats,
  isSolo,
  ROTATION_4,
  seatsOf,
} from './schema';
import {
  GIFT_STEPS,
  RESERVE_MS,
  consentComplete,
  consentOutstanding,
  giftTarget,
  giftLabel,
  giftUpdate,
  heldByOther,
  mayMoveNow,
  swapSettleUpdate,
  swappableSeats,
} from './writes';
import type { Slot } from '../game/types';

const UID: Record<Slot, string> = {
  P1: 'uid-p1',
  P2: 'uid-p2',
  P3: 'uid-p3',
  P4: 'uid-p4',
};
const NOW = 1_700_000_000_000;

function game(overrides: Partial<NetGame> = {}, fill: Slot[] = ['P1', 'P2', 'P3', 'P4']): NetGame {
  return {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    host: UID.P1,
    turnIndex: 0,
    toMove: 'P1',
    rotation: ROTATION_4,
    seats: 4,
    clocks: { w: 600000, b: 600000 },
    initialClock: 600000,
    lastMoveAt: NOW,
    status: 'active',
    result: null,
    createdAt: NOW,
    players: Object.fromEntries(
      fill.map((slot) => [slot, { uid: UID[slot], connected: true, lastSeen: NOW }]),
    ),
    ...overrides,
  };
}

describe('a team playing a man down', () => {
  it('counts an army with one player as manned', () => {
    const short = game({}, ['P1', 'P2', 'P3']);
    expect(armyManned(short, 'b')).toBe(true);
    expect(canStart(short)).toBe(true);
  });

  it('refuses to start with an army nobody is on', () => {
    expect(canStart(game({}, ['P1', 'P2']))).toBe(false);
  });

  it('reports the seat carrying its army alone', () => {
    const short = game({}, ['P1', 'P2', 'P3']);
    expect(isSolo(short, 'P3')).toBe(true);
    expect(isSolo(short, 'P1')).toBe(false);
  });

  it('lists the seats still open', () => {
    expect(emptySeats(game({}, ['P1', 'P3']))).toEqual(['P2', 'P4']);
  });

  it('lets the lone teammate play the empty seat with no grace period', () => {
    // P4 never turned up, and the rotation has reached it.
    const short = game({ toMove: 'P4', turnIndex: 3 }, ['P1', 'P2', 'P3']);
    expect(mayMoveNow(short, UID.P3, NOW)).toBe(true);
  });

  it('still refuses the opponents that same turn', () => {
    const short = game({ toMove: 'P4', turnIndex: 3 }, ['P1', 'P2', 'P3']);
    expect(mayMoveNow(short, UID.P1, NOW)).toBe(false);
    expect(mayMoveNow(short, 'uid-nobody', NOW)).toBe(false);
  });

  it('does not skip the grace period for a seat that is merely absent', () => {
    // Taken, but disconnected a moment ago: the wait still applies, because
    // somebody really might be coming back to it.
    const dropped = game({ toMove: 'P4', turnIndex: 3 });
    dropped.players!.P4 = { uid: UID.P4, connected: false, lastSeen: NOW - 1000 };
    expect(mayMoveNow(dropped, UID.P3, NOW)).toBe(false);
  });

  it('lets a short-handed army agree without the empty seat', () => {
    const short = game({}, ['P1', 'P2', 'P3']);
    const offer: Offer = { kind: 'resign', army: 'b', by: 'P3', at: NOW, accept: { P3: true } };
    expect(consentOutstanding(short, offer)).toEqual([]);
    expect(consentComplete(short, offer)).toBe(true);
  });

  it('still needs the teammate when there is one', () => {
    const offer: Offer = { kind: 'resign', army: 'b', by: 'P3', at: NOW, accept: { P3: true } };
    expect(consentOutstanding(game(), offer)).toEqual(['P4']);
  });
});

describe('holding a seat while you take it', () => {
  const held = (at: number) =>
    game({ reserve: { P4: { uid: UID.P4, at } } }, ['P1', 'P2', 'P3']);

  it('blocks everyone else for the length of the window', () => {
    expect(heldByOther(held(NOW), 'P4', 'uid-nobody', NOW)).toBe(true);
  });

  it('never blocks the holder themselves', () => {
    expect(heldByOther(held(NOW), 'P4', UID.P4, NOW)).toBe(false);
  });

  it('expires on its own, so a dead client cannot wedge a seat shut', () => {
    const stale = held(NOW - RESERVE_MS - 1);
    expect(heldByOther(stale, 'P4', 'uid-nobody', NOW)).toBe(false);
  });

  it('blocks nobody when there is no hold at all', () => {
    expect(heldByOther(game({}, ['P1']), 'P4', 'uid-nobody', NOW)).toBe(false);
  });
});

describe('trading seats', () => {
  const offer: Offer = {
    kind: 'swap',
    army: 'w',
    by: 'P1',
    with: 'P3',
    at: NOW,
    accept: { P1: true },
  };

  it('needs both named seats, and only those two', () => {
    expect(consentOutstanding(game(), offer)).toEqual(['P3']);
    expect(
      consentOutstanding(game(), { ...offer, accept: { P1: true, P3: true } }),
    ).toEqual([]);
  });

  it('exchanges the two uids in one update', () => {
    const swap = swapSettleUpdate(game(), { ...offer, accept: { P1: true, P3: true } });
    expect(swap).toMatchObject({
      'players/P1': { uid: UID.P3 },
      'players/P3': { uid: UID.P1 },
    });
  });

  it('carries each name to the seat that player lands in', () => {
    const named = game();
    named.players!.P1 = { uid: UID.P1, name: 'Alice', connected: true, lastSeen: NOW };
    named.players!.P3 = { uid: UID.P3, name: 'Carol', connected: true, lastSeen: NOW };
    expect(swapSettleUpdate(named, offer)).toMatchObject({
      'players/P1': { uid: UID.P3, name: 'Carol' },
      'players/P3': { uid: UID.P1, name: 'Alice' },
    });
  });

  it('has nothing to settle when a named seat is empty', () => {
    expect(swapSettleUpdate(game({}, ['P1']), offer)).toBeNull();
  });

  it('offers a trade with every taken seat but your own', () => {
    expect(swappableSeats(game(), 'P1')).toEqual(['P3', 'P2', 'P4']);
    expect(swappableSeats(game({}, ['P1', 'P3']), 'P1')).toEqual(['P3']);
  });

  it('offers nothing to somebody with no seat', () => {
    expect(swappableSeats(game(), null)).toEqual([]);
  });
});

describe('handing the other team time', () => {
  it('always points at the opponents, never at your own clock', () => {
    expect(giftTarget(game(), UID.P1)).toBe('b');
    expect(giftTarget(game(), UID.P3)).toBe('w');
  });

  it('is offered to nobody outside the game', () => {
    expect(giftTarget(game(), 'uid-nobody')).toBeNull();
  });

  it('is not offered once the game is over', () => {
    expect(giftTarget(game({ status: 'checkmate' }), UID.P1)).toBeNull();
  });

  it('defaults to the smallest step, and touches nothing else', () => {
    expect(giftUpdate(game(), 'b')).toEqual({ 'clocks/b': 600000 + 15000 });
  });

  it.each(GIFT_STEPS)('adds exactly %ims when that step is chosen', (ms) => {
    expect(giftUpdate(game(), 'b', ms)).toEqual({ 'clocks/b': 600000 + ms });
  });

  it('labels the steps the way the slider prints them', () => {
    expect(GIFT_STEPS.map(giftLabel)).toEqual(['15s', '30s', '1m', '2m', '5m']);
  });
});

describe('the rotation is unchanged by any of this', () => {
  it('still walks the same cycle whoever is sitting in it', () => {
    expect(seatsOf(game({}, ['P1']))).toEqual(['P1', 'P3', 'P2', 'P4']);
  });
});
