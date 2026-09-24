import type { SharedStateClient } from "shared/ReactTypes.ts";

// The state `react` shares with its renderers. It is exported from the
// package under upstream's name, and renderers read it from there, so an app
// with this `react` and a renderer built against it share one object.
export const ReactSharedInternals: SharedStateClient = {
  H: null,
  A: null,
  T: null,
  S: null,
  actQueue: null,
  asyncTransitions: 0,
  isBatchingLegacy: false,
  didScheduleLegacyUpdate: false,
  didUsePromise: false,
  thrownErrors: [],
  getCurrentStack: null,
  recentlyCreatedOwnerStacks: 0,
};
