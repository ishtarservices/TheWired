/**
 * Subscribes to the Redux store and resolves when a predicate becomes true.
 * Rejects after timeout (default 5s).
 */
import type { Store } from "@reduxjs/toolkit";
import type { RootState } from "@/store";

export function waitForReduxState(
  store: Store<RootState>,
  predicate: (state: RootState) => boolean,
  timeout = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check immediately
    if (predicate(store.getState())) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("waitForReduxState timed out"));
    }, timeout);

    const unsubscribe = store.subscribe(() => {
      if (predicate(store.getState())) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}
