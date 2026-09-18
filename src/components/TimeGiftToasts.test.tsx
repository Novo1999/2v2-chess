import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGame } from '../net/hooks';
import { ROTATION_2, ROTATION_4, type NetGame } from '../net/schema';
import { TimeGiftToasts, useTimeGiftToasts } from './TimeGiftToasts';

const firebase = vi.hoisted(() => ({ onValue: vi.fn(), ref: vi.fn() }));
vi.mock('firebase/database', async (original) => ({
  ...await original<typeof import('firebase/database')>(),
  ...firebase,
}));
vi.mock('../net/firebase', () => ({ getDb: () => ({}), signIn: vi.fn() }));

let receive: (game: NetGame | null) => void;

beforeEach(() => {
  vi.clearAllMocks();
  firebase.onValue.mockImplementation((_node, next) => {
    receive = (game) => next({ exists: () => game !== null, val: () => game });
    return vi.fn();
  });
});

function game(): NetGame {
  const player = (uid: string, name: string) => ({ uid, name, connected: true, lastSeen: 1000 });
  return {
    host: 'alice',
    fen: '',
    turnIndex: 0,
    toMove: 'P1',
    rotation: ROTATION_4,
    seats: 4,
    clocks: { w: 600_000, b: 600_000 },
    initialClock: 600_000,
    lastMoveAt: 1000,
    status: 'active',
    result: null,
    createdAt: 1000,
    players: {
      P1: player('alice', 'Alice'),
      P2: player('bob', 'Bob'),
      P3: player('carol', 'Carol'),
      P4: player('dave', 'Dave'),
    },
  };
}

function GameScreen({ uid, gameId = 'ABCDE' }: { uid: string; gameId?: string }) {
  const { manager, observe } = useTimeGiftToasts(gameId, uid);
  useGame(gameId, observe);
  return <TimeGiftToasts manager={manager} />;
}

const snapshot = (next: NetGame | null) => act(() => receive(next));

describe('time donation notifications', () => {
  it.each(['carol', 'dave'])('notifies receiving teammate %s and names both donors', (uid) => {
    render(<GameScreen uid={uid} />);
    const live = game();
    snapshot(live);
    expect(screen.queryByRole('dialog')).toBeNull();
    snapshot({ ...live, clocks: { ...live.clocks, b: 720_000 } });
    expect(screen.getByRole('dialog', {
      name: 'Alice and Bob have donated you 2 minutes.',
    })).toBeTruthy();
  });

  it('names one opponent and uses the singular minute in a two-player game', () => {
    render(<GameScreen uid="carol" />);
    const live = game();
    live.seats = 2;
    live.rotation = ROTATION_2;
    delete live.players!.P2;
    delete live.players!.P4;
    snapshot(live);
    snapshot({ ...live, clocks: { ...live.clocks, b: 660_000 } });
    expect(screen.getByRole('dialog', {
      name: 'Alice has donated you 1 minute.',
    })).toBeTruthy();
  });

  it('names a lone donor in a short-handed match and handles seconds', () => {
    render(<GameScreen uid="carol" />);
    const live = game();
    delete live.players!.P2;
    snapshot(live);
    snapshot({ ...live, clocks: { ...live.clocks, b: 615_000 } });
    expect(screen.getByRole('dialog', {
      name: 'Alice has donated you 15 seconds.',
    })).toBeTruthy();
  });

  it.each(['alice', 'bob', 'spectator'])('does not notify %s about the other side receiving time', (uid) => {
    render(<GameScreen uid={uid} />);
    const live = game();
    snapshot(live);
    snapshot({ ...live, clocks: { ...live.clocks, b: 660_000 } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps rapid donations separate even when React batches their snapshots', () => {
    render(<GameScreen uid="carol" />);
    const live = game();
    snapshot(live);
    act(() => {
      receive({ ...live, clocks: { ...live.clocks, b: 615_000 } });
      receive({ ...live, clocks: { ...live.clocks, b: 645_000 } });
    });
    expect(screen.getByRole('dialog', { name: /donated you 15 seconds/ })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /donated you 30 seconds/ })).toBeTruthy();
  });

  it('does not replay donations on repeated snapshots or room changes', () => {
    const { rerender } = render(<GameScreen uid="carol" />);
    const live = game();
    snapshot(live);
    const donated = { ...live, clocks: { ...live.clocks, b: 660_000 } };
    snapshot(donated);
    snapshot({ ...donated });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    rerender(<GameScreen uid="carol" gameId="FGHIJ" />);
    snapshot({ ...live, clocks: { ...live.clocks, b: 720_000 } });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('ignores ordinary clock updates and a rejected move being rolled back', () => {
    render(<GameScreen uid="alice" />);
    const live = game();
    snapshot(live);
    snapshot({ ...live, turnIndex: 1, toMove: 'P3', clocks: { w: 585_000, b: 600_000 } });
    snapshot(live);
    snapshot({ ...live, clocks: { w: 601_000, b: 600_000 } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets the recipient dismiss the toast', async () => {
    render(<GameScreen uid="carol" />);
    const live = game();
    snapshot(live);
    snapshot({ ...live, clocks: { ...live.clocks, b: 900_000 } });
    const user = userEvent.setup();
    await user.hover(screen.getByRole('dialog'));
    await user.click(screen.getByRole('button', { name: 'Dismiss time donation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
