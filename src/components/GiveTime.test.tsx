/**
 * The two panel controls that changed: handing the other team time, and who is
 * offered an empty seat once the clocks are running.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GiveTime, OpenSeats } from '../OnlineGame';
import type { NetGame } from '../net/schema';
import { ROTATION_4 } from '../net/schema';
import { GIFT_STEPS } from '../net/writes';
import type { Slot } from '../game/types';

const UID: Record<Slot, string> = {
  P1: 'uid-p1',
  P2: 'uid-p2',
  P3: 'uid-p3',
  P4: 'uid-p4',
};
const NOW = 1_700_000_000_000;

function game(fill: Slot[] = ['P1', 'P2', 'P3', 'P4'], overrides: Partial<NetGame> = {}): NetGame {
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

/**
 * Drag the slider to a step. Base UI keeps a real `<input type="range">` behind
 * the rendered track for form integration and assistive technology, so setting
 * that is the same event a drag produces.
 */
function slideTo(index: number) {
  fireEvent.change(screen.getByRole('slider'), { target: { value: String(index) } });
}

/** Open the popover and hand back the spy. */
async function openGiveTime(uid: string, live = game()) {
  const user = userEvent.setup();
  const onGive = vi.fn();
  render(<GiveTime game={live} uid={uid} busy={false} onGive={onGive} />);
  await user.click(screen.getByRole('button', { name: /Give time/ }));
  return { user, onGive };
}

describe('handing the other team time', () => {
  it('is offered to a seated player, pointed at their opponents', async () => {
    await openGiveTime(UID.P1);
    expect(screen.getByText('Give Black time')).toBeTruthy();
  });

  it('points the other way for the other army', async () => {
    await openGiveTime(UID.P3);
    expect(screen.getByText('Give White time')).toBeTruthy();
  });

  it('is not offered to somebody with no seat', () => {
    render(<GiveTime game={game()} uid="uid-nobody" busy={false} onGive={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Give time/ })).toBeNull();
  });

  it('is not offered once the game is over', () => {
    render(
      <GiveTime
        game={game(undefined, { status: 'checkmate' })}
        uid={UID.P1}
        busy={false}
        onGive={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Give time/ })).toBeNull();
  });

  it('marks exactly the five steps under the track', async () => {
    await openGiveTime(UID.P1);
    for (const label of ['15s', '30s', '1m', '2m', '5m']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('starts on the smallest step', async () => {
    const { onGive } = await openGiveTime(UID.P1);
    expect(screen.getByRole('button', { name: 'Give 15s' })).toBeTruthy();
    expect(onGive).not.toHaveBeenCalled();
  });

  it('follows the slider, and gives the amount that is showing', async () => {
    const { user, onGive } = await openGiveTime(UID.P1);

    slideTo(3);
    await user.click(screen.getByRole('button', { name: 'Give 2m' }));

    expect(onGive).toHaveBeenCalledWith('b', 120_000);
  });

  it('gives the largest step at the end of the track', async () => {
    const { user, onGive } = await openGiveTime(UID.P3);

    slideTo(GIFT_STEPS.length - 1);
    await user.click(screen.getByRole('button', { name: 'Give 5m' }));

    expect(onGive).toHaveBeenCalledWith('w', GIFT_STEPS[GIFT_STEPS.length - 1]);
  });

  it('reads the amount out for anyone who cannot see the notches', async () => {
    await openGiveTime(UID.P1);

    slideTo(2);
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('1m');

    slideTo(4);
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('5m');
  });

  it('steps one amount per arrow press, however far apart they are', async () => {
    const { user, onGive } = await openGiveTime(UID.P1);

    // The slider runs over the INDEX of the steps, not over milliseconds, so
    // 15s -> 30s and 2m -> 5m are each a single press.
    const slider = screen.getByRole('slider');
    slider.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    await user.click(screen.getByRole('button', { name: 'Give 1m' }));

    expect(onGive).toHaveBeenCalledWith('b', 60_000);
  });
});

describe('open seats during a match', () => {
  const short = () => game(['P1', 'P2', 'P3']);

  it('invites somebody with no seat to take the empty one', () => {
    render(<OpenSeats game={short()} mySlot={null} busy={false} onTake={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Take P4/ })).toBeTruthy();
  });

  // Hopping across the table with the clocks running changes who is on whose
  // side, which is not a thing the rest of the table agreed to.
  it('offers a seated player nothing, not even their own side', () => {
    render(<OpenSeats game={short()} mySlot="P3" busy={false} onTake={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says nothing at all when every seat is taken', () => {
    render(<OpenSeats game={game()} mySlot={null} busy={false} onTake={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stays out of the way until the game is under way', () => {
    render(
      <OpenSeats
        game={game(['P1', 'P2', 'P3'], { status: 'lobby' })}
        mySlot={null}
        busy={false}
        onTake={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('claims the seat that was clicked', async () => {
    const user = userEvent.setup();
    const onTake = vi.fn();
    render(<OpenSeats game={short()} mySlot={null} busy={false} onTake={onTake} />);

    await user.click(screen.getByRole('button', { name: /Take P4/ }));
    expect(onTake).toHaveBeenCalledWith('P4');
  });
});
