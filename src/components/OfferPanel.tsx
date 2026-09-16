import type { Slot } from '../game/types';
import type { NetGame, Offer } from '../net/schema';
import { consentOutstanding } from '../net/writes';

interface Props {
  game: NetGame;
  offer: Offer;
  mySlot: Slot | null;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * Decision #3 made visible. The interesting part of consultation chess is that
 * conceding is not yours alone to do, so the panel names exactly who has not
 * agreed yet rather than showing a bare "waiting".
 */
export function OfferPanel({ game, offer, mySlot, onAccept, onDecline }: Props) {
  const outstanding = consentOutstanding(game, offer);
  const mine = mySlot !== null && outstanding.includes(mySlot);
  const label = offer.kind === 'draw' ? 'a draw' : `${army(offer.army)} to resign`;

  return (
    <div className="offer" role="status">
      <p>
        <strong>{offer.by}</strong> proposes {label}.
      </p>
      <p className="waiting">
        {outstanding.length === 0
          ? 'Everyone has agreed.'
          : `Waiting on ${outstanding.join(', ')}.`}
      </p>
      <div className="offer-actions">
        <button className="primary" onClick={onAccept} disabled={!mine}>
          {mine ? 'Agree' : 'Agreed'}
        </button>
        <button onClick={onDecline} disabled={mySlot === null}>
          Withdraw
        </button>
      </div>
    </div>
  );
}

function army(color: 'w' | 'b'): string {
  return color === 'w' ? 'White' : 'Black';
}
