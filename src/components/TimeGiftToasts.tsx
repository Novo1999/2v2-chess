import { useRef, useState } from 'react';
import { Toast } from '@base-ui/react/toast';
import { SLOT_COLOR } from '../game/types';
import { armySeats, type NetGame } from '../net/schema';
import { GIFT_STEPS, seatOfUid } from '../net/writes';

/** Observe each database update so React batching cannot merge two gifts. */
export function useTimeGiftToasts(gameId: string, uid: string) {
  const [manager] = useState(() => Toast.createToastManager());
  const previous = useRef<{ gameId: string; game: NetGame | null } | null>(null);

  function observe(game: NetGame | null) {
    const before = previous.current;
    previous.current = { gameId, game };
    if (!game || !before?.game || before.gameId !== gameId) return;
    if (game.status !== 'active' || before.game.status !== 'active') return;
    // Gifts change a clock without advancing the turn. Moves and rollbacks
    // must never look like a donation, even if they correct a clock upwards.
    if (game.turnIndex !== before.game.turnIndex) return;

    const slot = seatOfUid(game, uid);
    if (!slot || seatOfUid(before.game, uid) !== slot) return;
    const army = SLOT_COLOR[slot];
    const amount = game.clocks[army] - before.game.clocks[army];
    if (!GIFT_STEPS.some((step) => step === amount)) return;

    const donors = armySeats(game, army === 'w' ? 'b' : 'w')
      .filter((seat) => game.players?.[seat]?.uid)
      .map((seat) => game.players?.[seat]?.name?.trim() || seat);
    const who = donors.length ? donors.join(' and ') : 'Your opponent';
    const duration = amount < 60_000
      ? `${amount / 1000} seconds`
      : `${amount / 60_000} minute${amount === 60_000 ? '' : 's'}`;

    manager.add({
      title: `${who} ${donors.length > 1 ? 'have' : 'has'} donated you ${duration}.`,
    });
  }

  return { manager, observe };
}

export function TimeGiftToasts({ manager }: {
  manager: ReturnType<typeof Toast.createToastManager>;
}) {
  return (
    <Toast.Provider toastManager={manager} timeout={5000} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="gift-toast-viewport">
          <GiftToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function GiftToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root key={toast.id} toast={toast} className="gift-toast" swipeDirection={['right']}>
      <Toast.Content className="gift-toast-content">
        <Toast.Title className="gift-toast-title" />
        <Toast.Close className="gift-toast-close" aria-label="Dismiss time donation">
          ×
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}
