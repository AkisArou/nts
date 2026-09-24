// `react-noop-renderer`: the noop renderer in mutation mode. Its bundle
// forks react-reconciler's ReactFiberConfig.ts to
// ./ReactFiberConfigNoopMutation.ts.

import { createReactNoop } from "./createReactNoop.ts";

const ReactNoop = createReactNoop(true);

export const {
  _Scheduler,
  getChildren,
  dangerouslyGetChildren,
  getPendingChildren,
  dangerouslyGetPendingChildren,
  getOrCreateRootContainer,
  createRoot,
  createLegacyRoot,
  getChildrenAsJSX,
  getPendingChildrenAsJSX,
  getSuspenseyThingStatus,
  resolveSuspenseyThing,
  resetSuspenseyThingCache,
  createPortal,
  render,
  renderLegacySyncRoot,
  renderToRootWithID,
  unmountRootWithID,
  findInstance,
  flushNextYield,
  startTrackingHostCounters,
  stopTrackingHostCounters,
  expire,
  flushExpired,
  batchedUpdates,
  deferredUpdates,
  discreteUpdates,
  idleUpdates,
  flushSync,
  flushPassiveEffects,
  dumpTree,
  getRoot,
  unstable_runWithPriority,
} = ReactNoop;

// Upstream's entry destructures an `act` the renderer does not define, so
// the export exists and is undefined. Tests use internal-test-utils' act.
export const act: undefined = undefined;
