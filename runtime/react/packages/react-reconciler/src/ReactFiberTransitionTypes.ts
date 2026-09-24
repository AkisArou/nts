import { enableViewTransition } from "shared/ReactFeatureFlags.ts";
import type { TransitionTypes } from "shared/ReactTypes.ts";
import { includesTransitionLane } from "./ReactFiberLane.ts";
import type { FiberRoot } from "./ReactInternalTypes.ts";

function appendUnique(queued: TransitionTypes, transitionTypes: TransitionTypes): void {
  for (let i = 0; i < transitionTypes.length; i++) {
    const transitionType = transitionTypes[i]!;
    if (queued.indexOf(transitionType) === -1) {
      queued.push(transitionType);
    }
  }
}

export function queueTransitionTypes(root: FiberRoot, transitionTypes: TransitionTypes): void {
  if (enableViewTransition) {
    // TODO: We should really store transitionTypes per lane in a LaneMap on
    // the root. Then merge it when we commit. We currently assume that all
    // Transitions are entangled.
    if (includesTransitionLane(root.pendingLanes)) {
      let queued = root.transitionTypes;
      if (queued === null) {
        queued = root.transitionTypes = [];
      }
      appendUnique(queued, transitionTypes);
    }
  }
}

// Store all types while we're entangled with an async Transition.
export let entangledTransitionTypes: TransitionTypes | null = null;

export function entangleAsyncTransitionTypes(transitionTypes: TransitionTypes): void {
  if (enableViewTransition) {
    let queued = entangledTransitionTypes;
    if (queued === null) {
      queued = entangledTransitionTypes = [];
    }
    appendUnique(queued, transitionTypes);
  }
}

export function clearEntangledAsyncTransitionTypes(): void {
  // Called when all Async Actions are done.
  entangledTransitionTypes = null;
}

export function claimQueuedTransitionTypes(root: FiberRoot): TransitionTypes | null {
  const claimed = root.transitionTypes;
  root.transitionTypes = null;
  return claimed;
}
