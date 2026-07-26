import { useEffect, useState } from "react";

/**
 * Delay reacting to a rapidly-changing value until it settles.
 *
 * Search is the reason this exists. Every character typed into the People or
 * Reach Out search box used to run a complete query — reading the whole dataset
 * and ranking every Person. At 3,000 contacts a five-letter name cost five full
 * queries back to back. Debouncing collapses that to one, which is both far
 * faster and the behaviour a user expects: results settle when they stop
 * typing, not once per keystroke.
 *
 * The initial value is returned immediately, so a screen's first load is never
 * delayed — only subsequent changes wait.
 */
export const SEARCH_DEBOUNCE_MS = 200;

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (Object.is(value, debounced)) return undefined;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, debounced, delayMs]);

  return debounced;
}
