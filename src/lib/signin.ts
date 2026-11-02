/**
 * One sign-in at a time. Repeat calls while one is in flight are ignored.
 * Success keeps the lock (the page is about to leave for `next`); failure
 * releases it and rethrows so the caller can show the error.
 */
export function signInLock(onChange: (locked: boolean) => void) {
  let held = false;
  return async (fn: () => Promise<unknown>) => {
    if (held) return;
    held = true;
    onChange(true);
    try {
      await fn();
    } catch (e) {
      held = false;
      onChange(false);
      throw e;
    }
  };
}

/** sessionStorage key set right before signInWithRedirect, so the return trip stays locked. */
export const REDIRECT_FLAG = "signinRedirect";
