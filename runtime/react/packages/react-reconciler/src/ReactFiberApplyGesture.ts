// Gesture transitions: cloning view-transition boundaries and applying a
// gesture's animation to them.
//
// enableGestureTransition is off in the stable channel, and the work loop
// only reaches these through the gesture commit path, which is unreachable
// without it. They keep upstream's signatures (ReactFiberApplyGesture.js)
// and throw if they are ever reached, rather than port behaviour nothing in
// this build can run.

import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";

function gestureTransitionsAreDisabled(): never {
  throw new Error("Gesture transitions are disabled in this build (enableGestureTransition is off).");
}

// Clone View Transition boundaries that have any mutations or might have had
// their layout affected by child insertions.
export function insertDestinationClones(_root: FiberRoot, _finishedWork: Fiber): void {
  gestureTransitionsAreDisabled();
}

// Revert insertions and apply view transition names to the "new" (current)
// state.
export function applyDepartureTransitions(_root: FiberRoot, _finishedWork: Fiber): void {
  gestureTransitionsAreDisabled();
}

// Revert transition names and start/adjust animations on the started View
// Transition.
export function startGestureAnimations(_root: FiberRoot, _finishedWork: Fiber): void {
  gestureTransitionsAreDisabled();
}
