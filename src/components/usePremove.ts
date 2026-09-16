import { useEffect, useRef, useState } from 'react';
import { applyMove, pieceAt, slotToMove } from '../game/rules';
import type { GameState, MoveIntent, PieceSymbol, Slot } from '../game/types';
import { SLOT_COLOR } from '../game/types';

interface QueuedPremove {
  intent: MoveIntent;
  by: Slot;
  piece: PieceSymbol;
  queuedAt: number;
  playAt: number;
}

/** A premove belongs to one seat's next turn, including in the four-seat game. */
export function usePremove(
  state: GameState,
  you: Slot | null,
  yours: boolean,
  browsing: boolean,
  onMove: (intent: MoveIntent) => void,
) {
  const [queued, setQueued] = useState<QueuedPremove | null>(null);
  const consumed = useRef<QueuedPremove | null>(null);
  const enabled = state.status === 'active' && you !== null &&
    state.turnOrder.includes(you) && !browsing;

  useEffect(() => {
    if (!queued || consumed.current === queued) return;
    const source = pieceAt(state.fen, queued.intent.from);
    const invalid = !enabled || you !== queued.by ||
      state.turnIndex < queued.queuedAt || state.turnIndex > queued.playAt ||
      source?.color !== SLOT_COLOR[queued.by] || source.type !== queued.piece;
    const ready = state.turnIndex === queued.playAt && slotToMove(state) === queued.by && yours;
    if (!invalid && !ready) return;

    // Consume before calling the transport: renders or effect replays must not
    // submit twice, including while an optimistic write is awaiting the server.
    consumed.current = queued;
    setQueued(null);
    if (!invalid && applyMove(state, queued.intent, queued.by).ok) onMove(queued.intent);
  }, [queued, state, you, yours, enabled, onMove]);

  function queue(intent: MoveIntent) {
    if (!enabled || !you || yours) return;
    const piece = pieceAt(state.fen, intent.from);
    if (piece?.color !== SLOT_COLOR[you]) return;
    const length = state.turnOrder.length;
    const distance = (state.turnOrder.indexOf(you) - state.turnIndex % length + length) % length;
    if (distance === 0) return;
    setQueued({ intent, by: you, piece: piece.type, queuedAt: state.turnIndex, playAt: state.turnIndex + distance });
  }

  return {
    premovable: enabled && !yours && slotToMove(state) !== you ? SLOT_COLOR[you] : null,
    premove: queued?.intent ?? null,
    queue,
    cancel: () => setQueued(null),
  };
}
