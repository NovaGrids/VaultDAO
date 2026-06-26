import { useEffect, useRef, useCallback } from 'react';

export interface UseIdleTimerOptions {
  /** Inactivity timeout in milliseconds. Default: 15 minutes. */
  timeoutMs?: number;
  /** Called when the user becomes idle (timeout reached). */
  onIdle: () => void;
  /** Called every second while counting down. Receives remaining seconds. */
  onCountdown?: (remainingSeconds: number) => void;
  /** How many seconds before timeout to start the countdown warning. Default: 60. */
  warningSeconds?: number;
  /** When false the timer is not started (e.g. user not connected). */
  enabled?: boolean;
}

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;

export function useIdleTimer({
  timeoutMs = 15 * 60 * 1000,
  onIdle,
  onCountdown,
  warningSeconds = 60,
  enabled = true,
}: UseIdleTimerOptions) {
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onIdleRef = useRef(onIdle);
  const onCountdownRef = useRef(onCountdown);

  onIdleRef.current = onIdle;
  onCountdownRef.current = onCountdown;

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(() => {
    clearTimers();
    let remaining = warningSeconds;
    onCountdownRef.current?.(remaining);
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      onCountdownRef.current?.(remaining);
      if (remaining <= 0) {
        clearTimers();
        onIdleRef.current();
      }
    }, 1000);
  }, [clearTimers, warningSeconds]);

  const resetTimer = useCallback(() => {
    clearTimers();
    // Schedule the warning-countdown start
    const warningDelay = timeoutMs - warningSeconds * 1000;
    idleTimerRef.current = setTimeout(() => {
      startCountdown();
    }, Math.max(0, warningDelay));
  }, [clearTimers, timeoutMs, warningSeconds, startCountdown]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      return;
    }

    resetTimer();

    const handleActivity = () => {
      // Only reset if we are in the idle-watch phase, not mid-countdown
      if (idleTimerRef.current !== null) {
        resetTimer();
      } else if (countdownIntervalRef.current !== null) {
        // Activity during countdown — cancel countdown and restart full timer
        resetTimer();
        onCountdownRef.current?.(0); // signal dismissed
      }
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }));

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, handleActivity));
    };
  }, [enabled, resetTimer, clearTimers]);

  return { resetTimer };
}
