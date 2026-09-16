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
  /** This side lost on time. */
  flagged?: boolean;
  /** Both teammates spend from this one budget — decision #2. */
  sharedBy?: string;
}

export function Clock({ ms, army, running, flagged = false, sharedBy }: Props) {
  // A running clock at zero has fallen already; the write that says so is
  // only a moment behind, and the players should not wait for it to see it.
  const out = flagged || (running && ms <= 0);
  const low = ms < 30000;
  const critical = running && ms < 10000;
  const classes = [
    'clock',
    `clock-${army}`,
    running && !out && 'running',
    low && 'low',
    critical && !out && 'critical',
    out && 'flagged',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <span className="clock-time">{formatClock(ms)}</span>
      {out ? (
        <span className="clock-flag" role="status">
          <FlagIcon />
          Time out
        </span>
      ) : (
        sharedBy && <span className="clock-owner">{sharedBy}</span>
      )}
    </div>
  );
}

export function FlagIcon() {
  return (
    <svg className="flag-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M5 2h2v20H5zM8 3h11l-2.5 4.5L19 12H8z" />
    </svg>
  );
}
