import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitePanel } from './InvitePanel';
import { sendInvite } from '../net/invites';
import { useOnlinePlayers } from '../net/presence';

vi.mock('../net/firebase', () => ({ getDb: () => ({}) }));
vi.mock('../net/hooks', () => ({ useTick: vi.fn() }));
vi.mock('../net/invites', () => ({ sendInvite: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../net/presence', async (original) => ({
  ...await original<typeof import('../net/presence')>(),
  useOnlinePlayers: vi.fn(),
}));

const panel = () => <InvitePanel me="host" myName="Alice" gameId="ABCDE" seated={['host']} />;
const player = { uid: 'guest', name: 'Bob', at: Date.now() };

beforeEach(() => vi.clearAllMocks());

describe('inviting available players', () => {
  it('does not let the host invite a player already in another room', async () => {
    vi.mocked(useOnlinePlayers).mockReturnValue([{ ...player, inRoom: true }]);
    render(panel());
    const button = screen.getByRole('button', { name: 'In a room' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.setup().click(button);
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it('makes the player invitable when they leave their room', async () => {
    vi.mocked(useOnlinePlayers).mockReturnValue([{ ...player, inRoom: true }]);
    const { rerender } = render(panel());
    vi.mocked(useOnlinePlayers).mockReturnValue([{ ...player, inRoom: false }]);
    rerender(panel());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Invite' }));
    expect(sendInvite).toHaveBeenCalledWith({}, 'host', 'Alice', 'guest', 'ABCDE');
    expect(screen.getByRole('button', { name: 'Invited' })).toBeDefined();
  });

  it('disables an available player as soon as they enter another room', () => {
    vi.mocked(useOnlinePlayers).mockReturnValue([{ ...player, inRoom: false }]);
    const { rerender } = render(panel());
    expect((screen.getByRole('button', { name: 'Invite' }) as HTMLButtonElement).disabled).toBe(false);
    vi.mocked(useOnlinePlayers).mockReturnValue([{ ...player, inRoom: true }]);
    rerender(panel());
    expect((screen.getByRole('button', { name: 'In a room' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
