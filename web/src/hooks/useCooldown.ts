import * as React from "react";

/**
 * Countdown used to disable an action after the server returns a 429, so the
 * button reflects the rate limit instead of letting the user keep clicking.
 */
export function useCooldown() {
  const [until, setUntil] = React.useState(0);
  const [remaining, setRemaining] = React.useState(0);

  React.useEffect(() => {
    if (!until) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) setUntil(0);
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [until]);

  return {
    remaining,
    active: remaining > 0,
    start: (seconds: number) => setUntil(Date.now() + Math.max(1, seconds) * 1000)
  };
}
