// Re-pressing the active tab returns its stack to the root screen (standard
// bottom-tab behavior; Discord/Instagram register). This matters doubly for
// deep links: linking.ts mounts nested screens as SINGLE-ROUTE states (the
// iOS-26 multi-push workaround), so without this a deep-linked user has no
// path back to the tab's root at all.

import { CommonActions } from "@react-navigation/native";

interface NestedStackState {
  key?: string;
  index?: number;
  routes?: Array<{ name?: string }>;
}

/**
 * Build a reset-to-root action scoped to one tab's nested stack, or null when
 * there's nothing to do (no nested state yet, or already resting on the root).
 */
export function tabResetAction(
  childState: unknown,
  rootScreen: string,
): (ReturnType<typeof CommonActions.reset> & { target: string }) | null {
  const state = childState as NestedStackState | undefined;
  if (!state?.key || !Array.isArray(state.routes) || state.routes.length === 0) return null;

  const activeIndex = state.index ?? state.routes.length - 1;
  const atRoot = state.routes.length === 1 && state.routes[activeIndex]?.name === rootScreen;
  if (atRoot) return null;

  return {
    ...CommonActions.reset({ index: 0, routes: [{ name: rootScreen }] }),
    target: state.key,
  };
}
