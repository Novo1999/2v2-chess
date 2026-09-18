import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomPresence } from './presence';

const firebase = vi.hoisted(() => ({
  ref: vi.fn((_db: unknown, path: string) => path),
  push: vi.fn(),
  onDisconnect: vi.fn(),
  onValue: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  serverTimestamp: vi.fn(),
}));
vi.mock('firebase/database', () => firebase);
vi.mock('./firebase', () => ({ getDb: () => ({}) }));

let connections: Array<(snap: { val: () => boolean }) => void>;
let handlers: Array<{ remove: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }>;

beforeEach(() => {
  vi.clearAllMocks();
  connections = [];
  handlers = [];
  let tab = 0;
  firebase.push.mockImplementation((path: string) => `${path}/tab-${++tab}`);
  firebase.onDisconnect.mockImplementation(() => {
    const handler = {
      remove: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    handlers.push(handler);
    return handler;
  });
  firebase.onValue.mockImplementation((_path: string, callback) => {
    connections.push(callback);
    return vi.fn();
  });
});

afterEach(cleanup);

async function connect(index = 0) {
  await act(async () => { connections[index]!({ val: () => true }); });
}

describe('availability while a room is open', () => {
  it('marks entry immediately and clears it on returning home', async () => {
    const { rerender } = renderHook(({ inRoom }) => useRoomPresence('guest', inRoom), {
      initialProps: { inRoom: true },
    });
    await connect();
    expect(firebase.set).toHaveBeenCalledWith('roomPresence/guest/tab-1', true);
    rerender({ inRoom: false });
    expect(firebase.remove).toHaveBeenCalledWith('roomPresence/guest/tab-1');
    expect(handlers[0]!.cancel).toHaveBeenCalled();
  });

  it('leaves another room tab marked when one tab closes', async () => {
    const first = renderHook(() => useRoomPresence('guest', true));
    const second = renderHook(() => useRoomPresence('guest', true));
    await connect(0);
    await connect(1);
    first.unmount();
    expect(firebase.remove.mock.calls).toEqual([['roomPresence/guest/tab-1']]);
    second.unmount();
    expect(firebase.remove).toHaveBeenLastCalledWith('roomPresence/guest/tab-2');
  });

  it('re-arms disconnect cleanup and restores the marker after reconnecting', async () => {
    renderHook(() => useRoomPresence('guest', true));
    await connect();
    await act(async () => { connections[0]!({ val: () => false }); });
    await connect();
    expect(handlers[0]!.remove).toHaveBeenCalledTimes(2);
    expect(firebase.set).toHaveBeenCalledTimes(2);
  });

  it('does not recreate the marker if the player leaves while cleanup is being registered', async () => {
    const { unmount } = renderHook(() => useRoomPresence('guest', true));
    let armed!: () => void;
    handlers[0]!.remove.mockReturnValue(new Promise<void>((resolve) => { armed = resolve; }));
    await connect();
    unmount();
    await act(async () => { armed(); });
    expect(firebase.set).not.toHaveBeenCalled();
  });

  it('does not mark a signed-out player or a tab on the home screen', () => {
    renderHook(() => useRoomPresence(null, true));
    renderHook(() => useRoomPresence('guest', false));
    expect(firebase.onDisconnect).not.toHaveBeenCalled();
  });
});
