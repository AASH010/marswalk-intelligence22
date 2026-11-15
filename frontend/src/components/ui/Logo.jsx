import { useId } from "react";

/** MarsWalk Intelligence mark: Mars with an orbit ring. */
function Logo({ size = 32 }) {
  const id = useId();
  return (
    <svg className="mw-logo" width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="MarsWalk Intelligence">
      <defs>
        <radialGradient id={`${id}-planet`} cx="38%" cy="34%" r="70%">
          <stop offset="0%" stopColor="var(--mw-brand-mars)" />
          <stop offset="100%" stopColor="var(--mw-brand-mars-shade)" />
        </radialGradient>
      </defs>
      <path d="M5.2 25.6C1.9 23.9.4 21.9 1.2 20.1c1.5-3.3 11-3.6 21.2-.7" fill="none" stroke="var(--mw-cyan)" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
      <circle cx="20" cy="20" r="10" fill={`url(#${id}-planet)`} />
      <path d="M13.2 16.4c1.6-1 3.4-.7 4.6.2M21 24.2c1.5.5 3.2.1 4.2-.9M22.6 14.6c.9.2 1.6.8 1.9 1.6" fill="none" stroke="var(--mw-brand-mars-shade)" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
      <path d="M22.4 19.4c10.200 2.900 17.700 8 16.200 11.300-1.5 3.300-11 3.600-21.200.7-4.800-1.400-9-3.200-12.200-5.200" fill="none" stroke="var(--mw-cyan)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="36.300" cy="27.400" r="1.7" fill="var(--mw-cyan)" />
    </svg>
  );
}

export default Logo;
