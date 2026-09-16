/**
 * Whether a seated player's browser is still attached to the game. A shared
 * clock keeps draining while someone is gone, so their teammate needs to see
 * it at a glance — not only once the takeover notice appears.
 */
export function PresenceIcon({ connected }: { connected: boolean }) {
  const label = connected ? 'Connected' : 'Disconnected';
  return connected ? (
    <span className="presence presence-on" role="img" aria-label={label} title={label} />
  ) : (
    <span className="presence presence-off" role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {/* An unplugged cable, struck through. */}
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          d="M3 3l18 18M9 7V3M15 7V3M7.5 7h9v4a4.5 4.5 0 0 1-1.3 3.2M12 15.5V21M8.8 14.2A4.5 4.5 0 0 1 7.5 11"
        />
      </svg>
    </span>
  );
}
