/**
 * The lobby is where a table gets arranged: taking a seat, moving across the
 * table, trading with somebody, and agreeing to start a player short.
 *
 * The rules suite proves the server refuses the wrong things. What is asserted
 * here is that the screen offers the right ones.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Lobby } from './Lobby';
import type { NetGame } from '../net/schema';
import { ROTATION_4 } from '../net/schema';
import { RESERVE_MS } from '../net/writes';
import type { Slot } from '../game/types';

const UID: Record<Slot, string> = {
  P1: 'uid-p1',
  P2: 'uid-p2',
  P3: 'uid-p3',
  P4: 'uid-p4',
};
const NOW = 1_700_000_000_000;
const NAMES: Partial<Record<Slot, string>> = {
  P1: 'Alice',
  P2: 'Bob',
  P3: 'Carol',
  P4: 'Dave',
};

function game(fill: Slot[], overrides: Partial<NetGame> = {}): NetGame {
  return {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turnIndex: 0,
    toMove: 'P1',
    rotation: ROTATION_4,
    seats: 4,
    clocks: { w: 600000, b: 600000 },
    initialClock: 600000,
    lastMoveAt: NOW,
    status: 'lobby',
    result: null,
    createdAt: NOW,
    players: Object.fromEntries(
      fill.map((slot) => [
        slot,
        { uid: UID[slot], name: NAMES[slot], connected: true, lastSeen: NOW },
      ]),
    ),
    ...overrides,
  };
}

const swapOffer = (accept: Partial<Record<Slot, boolean>>): NetGame['offer'] => ({
  kind: 'swap',
  army: 'w',
  by: 'P1',
  with: 'P3',
  at: NOW,
  accept,
});

/** Render the lobby as one of the players, with every handler spied on. */
function show(live: NetGame, mySlot: Slot | null, uid = mySlot ? UID[mySlot] : 'uid-new') {
  const handlers = {
    onClaim: vi.fn(),
    onMoveSeat: vi.fn(),
    onLeaveSeat: vi.fn(),
    onProposeSwap: vi.fn(),
    onAcceptSwap: vi.fn(),
    onDeclineSwap: vi.fn(),
    onStart: vi.fn(),
    onLeave: vi.fn(),
  };

  render(
    <Lobby
      gameId="ROOM42"
      game={live}
      mySlot={mySlot}
      uid={uid}
      now={NOW}
      name="Newcomer"
      onName={vi.fn()}
      busy={false}
      {...handlers}
    />,
  );

  return handlers;
}

const seatRow = (slot: Slot) => within(screen.getByText(slot).closest('.seatrow')!);
const disabled = (button: HTMLElement) => (button as HTMLButtonElement).disabled;
const hint = () => document.querySelector('.hint')?.textContent ?? '';

describe('taking a seat', () => {
  it('offers every empty seat to a player with none', () => {
    show(game(['P1']), null);
    expect(screen.getAllByRole('button', { name: 'Take this seat' })).toHaveLength(3);
  });

  it('greys out a seat somebody else is in the middle of taking', () => {
    show(game(['P1'], { reserve: { P3: { uid: UID.P3, at: NOW } } }), null);

    expect(seatRow('P3').queryByRole('button', { name: 'Take this seat' })).toBeNull();
    expect(seatRow('P3').getByText(/Being taken/)).toBeTruthy();
    // The other empty seats are untouched.
    expect(disabled(seatRow('P2').getByRole('button', { name: 'Take this seat' }))).toBe(false);
  });

  it('offers the seat again once the hold has expired', () => {
    const stale = game(['P1'], {
      reserve: { P3: { uid: UID.P3, at: NOW - RESERVE_MS - 1 } },
    });
    show(stale, null);
    expect(seatRow('P3').getByRole('button', { name: 'Take this seat' })).toBeTruthy();
  });

  it('never greys a seat out against the player holding it', () => {
    show(game(['P1'], { reserve: { P3: { uid: 'uid-new', at: NOW } } }), null);
    expect(seatRow('P3').getByRole('button', { name: 'Take this seat' })).toBeTruthy();
  });

  it('claims the seat that was clicked', async () => {
    const user = userEvent.setup();
    const handlers = show(game(['P1']), null);

    await user.click(seatRow('P4').getByRole('button', { name: 'Take this seat' }));
    expect(handlers.onClaim).toHaveBeenCalledWith('P4');
  });
});

describe('moving across the table', () => {
  it('offers to move rather than to take, once you are seated', async () => {
    const user = userEvent.setup();
    const handlers = show(game(['P1', 'P3']), 'P1');

    await user.click(seatRow('P2').getByRole('button', { name: 'Move here' }));
    expect(handlers.onMoveSeat).toHaveBeenCalledWith('P2');
    expect(handlers.onClaim).not.toHaveBeenCalled();
  });

  it('lets you leave the seat you are in', async () => {
    const user = userEvent.setup();
    const handlers = show(game(['P1', 'P3']), 'P1');

    await user.click(screen.getByRole('button', { name: 'Leave seat' }));
    expect(handlers.onLeaveSeat).toHaveBeenCalled();
  });

  it('offers to leave only your own seat', () => {
    show(game(['P1', 'P3']), 'P1');
    expect(screen.getAllByRole('button', { name: 'Leave seat' })).toHaveLength(1);
  });
});

describe('trading seats', () => {
  it('offers a trade with every taken seat but your own', () => {
    show(game(['P1', 'P2', 'P3']), 'P1');
    expect(screen.getAllByRole('button', { name: 'Swap' })).toHaveLength(2);
  });

  it('offers no trade at all to somebody with no seat', () => {
    show(game(['P1', 'P3']), null);
    expect(screen.queryByRole('button', { name: 'Swap' })).toBeNull();
  });

  it('proposes the trade against the seat that was clicked', async () => {
    const user = userEvent.setup();
    const handlers = show(game(['P1', 'P3']), 'P1');

    await user.click(seatRow('P3').getByRole('button', { name: 'Swap' }));
    expect(handlers.onProposeSwap).toHaveBeenCalledWith('P3');
  });

  it('asks the other player to sign, naming both seats', async () => {
    const user = userEvent.setup();
    const handlers = show(game(['P1', 'P3'], { offer: swapOffer({ P1: true }) }), 'P3');

    const prompt = document.querySelector('.notice.offer')!.textContent ?? '';
    expect(prompt).toContain('Alice');
    expect(prompt).toContain('Carol');

    await user.click(screen.getByRole('button', { name: 'Accept swap' }));
    expect(handlers.onAcceptSwap).toHaveBeenCalled();
  });

  it('shows the proposer a wait rather than a second signature', () => {
    show(game(['P1', 'P3'], { offer: swapOffer({ P1: true }) }), 'P1');

    expect(screen.queryByRole('button', { name: 'Accept swap' })).toBeNull();
    expect(document.querySelector('.notice.offer')!.textContent).toContain('Waiting');
  });

  // Every other button here would be answering a question that is about to
  // change underneath it.
  it('freezes the rest of the lobby while a trade is open', () => {
    show(game(['P1', 'P3'], { offer: swapOffer({ P1: true }) }), 'P3');
    expect(disabled(seatRow('P2').getByRole('button', { name: 'Move here' }))).toBe(true);
  });
});

describe('starting a player short', () => {
  it('will not start until both armies have somebody', () => {
    show(game(['P1', 'P2']), 'P1');
    expect(disabled(screen.getByRole('button', { name: /^Start/ }))).toBe(true);
  });

  it('offers to start a man down, and says so', () => {
    show(game(['P1', 'P2', 'P3']), 'P1');
    expect(disabled(screen.getByRole('button', { name: 'Start a man down' }))).toBe(false);
  });

  it('explains what becomes of the empty seat', () => {
    show(game(['P1', 'P2', 'P3']), 'P1');
    expect(hint()).toContain('played by its teammate');
    expect(hint()).toContain('later');
  });

  it('reads as an ordinary start once the table is full', () => {
    show(game(['P1', 'P2', 'P3', 'P4']), 'P1');
    expect(disabled(screen.getByRole('button', { name: 'Start game' }))).toBe(false);
    expect(hint()).toContain('Everyone is seated');
  });
});
