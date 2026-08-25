import { useEffect, useState } from 'react';

/** Debounce delay used by proposal search inputs. */
export const SEARCH_DEBOUNCE_MS = 200;

/**
 * Returns `value` delayed until it has stopped changing for `delayMs`.
 *
 * Search inputs stay controlled by the raw value so typing is never laggy,
 * while the expensive work downstream (filtering thousands of proposals) is
 * keyed off the debounced value and runs once the user pauses instead of once
 * per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    // A non-positive delay still goes through setTimeout, which defers to the
    // next tick rather than re-rendering synchronously from inside the effect.
    const timer = setTimeout(() => setDebounced(value), Math.max(0, delayMs));

    // Clearing on every change is what makes this a debounce rather than a
    // throttle: only the final value in a burst survives to fire.
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export default useDebouncedValue;
