import type { Color } from '../game/types';

/** Under a minute the tenths matter; above it they are just noise. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const total = Math.floor(clamped / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (clamped < 60000) {
    const tenths = Math.floor((clamped % 1000) / 100);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface Props {
  ms: number;
  army: Color;
  /** The draining side, drawn live. */
  running: boolean;
  /** Both teammates spend from this one budget — decision #2. */
  sharedBy?: string;
}

export function Clock({ ms, army, running, sharedBy }: Props) {
  const low = ms < 30000;
  return (
    <div
      className={`clock clock-${army} ${running ? 'running' : ''} ${low ? 'low' : ''}`}
    >
      <span className="clock-time">{formatClock(ms)}</span>
      {sharedBy && <span className="clock-owner">{sharedBy}</span>}
    </div>
  );
}
