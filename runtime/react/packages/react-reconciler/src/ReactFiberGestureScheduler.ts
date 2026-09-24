// Gesture transitions (`startGestureTransition`). enableGestureTransition is
// off in the stable channel, so no gesture is ever scheduled: these keep
// upstream's exports and signatures, and the work loop never reaches them.
import type { TransitionTypes } from "shared/ReactTypes.ts";
import type { GestureTimeline, RunningViewTransition } from "react-reconciler/ReactFiberConfig.ts";
import type { Lane } from "./ReactFiberLane.ts";
import type { FiberRoot } from "./ReactInternalTypes.ts";

export interface ScheduledGesture {
  provider: GestureTimeline;
  // The number of times this same provider has been started.
  count: number;
  // The percentage along the timeline where the "current" state starts.
  rangeStart: number;
  // The percentage along the timeline where the "destination" state is reached.
  rangeEnd: number;
  // Any addTransitionType call made during startGestureTransition.
  types: TransitionTypes | null;
  // Used to cancel the running transition after we're done.
  running: RunningViewTransition | null;
  // Callback to run to commit if there's a pending commit.
  commit: (() => void) | null;
  // If the gesture was released in a committed state and should actually commit.
  committing: boolean;
  // The Lane that we'll use to schedule the revert.
  revertLane: Lane;
  prev: ScheduledGesture | null;
  next: ScheduledGesture | null;
}

function gesturesAreDisabled(): never {
  throw new Error("Gesture transitions are not enabled in this build of React.");
}

export function scheduleGesture(_root: FiberRoot, _provider: GestureTimeline): ScheduledGesture {
  return gesturesAreDisabled();
}

export function startScheduledGesture(
  _root: FiberRoot,
  _gestureTimeline: GestureTimeline,
  _gestureOptions: unknown,
  _transitionTypes: TransitionTypes | null,
): ScheduledGesture | null {
  return gesturesAreDisabled();
}

export function cancelScheduledGesture(_root: FiberRoot, _gesture: ScheduledGesture): void {
  gesturesAreDisabled();
}

export function stopCommittedGesture(_root: FiberRoot): void {
  gesturesAreDisabled();
}

export function scheduleGestureCommit(_gesture: ScheduledGesture, _callback: () => void): () => void {
  return gesturesAreDisabled();
}
