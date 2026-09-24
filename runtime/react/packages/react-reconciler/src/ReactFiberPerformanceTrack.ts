// Logging to the browser's performance timeline (Chrome's "Components ⚛" and
// "Scheduler ⚛" tracks, through `console.timeStamp` and
// `performance.measure`).
//
// Not ported yet: every function has upstream's signature and does nothing.
// It feeds only the timeline and emits no console output React's tests
// assert on, apart from upstream's own performance-track tests, which spy on
// `console.timeStamp`. The deep-equality bookkeeping is kept because the
// commit code pushes and pops it.

import { isDevelopment } from "shared/Build.ts";
import type { CapturedValue } from "./ReactCapturedValue.ts";
import type { Lanes } from "./ReactFiberLane.ts";
import { getGroupNameOfHighestPriorityLane } from "./ReactFiberLane.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

// `console.createTask`'s task: stored and passed through, never inspected.
type ConsoleTask = unknown;

// The lane group the next render is logged under.
let currentTrack: string = "Blocking";

export function setCurrentTrackFromLanes(lanes: Lanes): void {
  currentTrack = getGroupNameOfHighestPriorityLane(lanes);
}

export function getCurrentTrack(): string {
  return currentTrack;
}

export function markAllLanesInOrder(): void {}

export function logComponentMount(_fiber: Fiber, _startTime: number, _endTime: number): void {}

export function logComponentUnmount(_fiber: Fiber, _startTime: number, _endTime: number): void {}

export function logComponentReappeared(_fiber: Fiber, _startTime: number, _endTime: number): void {}

export function logComponentDisappeared(_fiber: Fiber, _startTime: number, _endTime: number): void {}

// Whether a parent already warned about deeply equal props in this subtree.
let alreadyWarnedForDeepEquality = false;

export function pushDeepEquality(): boolean {
  if (isDevelopment) {
    // If this is true then we don't reset it to false because we're tracking if any
    // parent already warned about having deep equality props in this subtree.
    return alreadyWarnedForDeepEquality;
  }
  return false;
}

export function popDeepEquality(prev: boolean): void {
  if (isDevelopment) {
    alreadyWarnedForDeepEquality = prev;
  }
}

export function logComponentRender(
  _fiber: Fiber,
  _startTime: number,
  _endTime: number,
  _wasHydrated: boolean,
  _committedLanes: Lanes,
): void {}

export function logComponentErrored(
  _fiber: Fiber,
  _startTime: number,
  _endTime: number,
  _errors: CapturedValue<unknown>[],
): void {}

export function logComponentEffect(
  _fiber: Fiber,
  _startTime: number,
  _endTime: number,
  _selfTime: number,
  _errors: CapturedValue<unknown>[] | null,
): void {}

export function logYieldTime(_startTime: number, _endTime: number): void {}

export function logSuspendedYieldTime(_startTime: number, _endTime: number, _suspendedFiber: Fiber): void {}

export function logActionYieldTime(_startTime: number, _endTime: number, _suspendedFiber: Fiber): void {}

export function logBlockingStart(
  _updateTime: number,
  _eventTime: number,
  _eventType: string | null,
  _eventIsRepeat: boolean,
  _isSpawnedUpdate: boolean,
  _isPingedUpdate: boolean,
  _renderStartTime: number,
  _lanes: Lanes,
  _debugTask: ConsoleTask | null,
  _updateMethodName: string | null,
  _updateComponentName: string | null,
): void {}

export function logGestureStart(
  _updateTime: number,
  _eventTime: number,
  _eventType: string | null,
  _eventIsRepeat: boolean,
  _isPingedUpdate: boolean,
  _renderStartTime: number,
  _debugTask: ConsoleTask | null,
  _updateMethodName: string | null,
  _updateComponentName: string | null,
): void {}

export function logTransitionStart(
  _startTime: number,
  _updateTime: number,
  _eventTime: number,
  _eventType: string | null,
  _eventIsRepeat: boolean,
  _isPingedUpdate: boolean,
  _renderStartTime: number,
  _debugTask: ConsoleTask | null,
  _updateMethodName: string | null,
  _updateComponentName: string | null,
): void {}

export function logRenderPhase(_startTime: number, _endTime: number, _lanes: Lanes, _debugTask: ConsoleTask | null): void {}

export function logInterruptedRenderPhase(
  _startTime: number,
  _endTime: number,
  _lanes: Lanes,
  _debugTask: ConsoleTask | null,
): void {}

export function logSuspendedRenderPhase(
  _startTime: number,
  _endTime: number,
  _lanes: Lanes,
  _debugTask: ConsoleTask | null,
): void {}

export function logSuspendedWithDelayPhase(
  _startTime: number,
  _endTime: number,
  _lanes: Lanes,
  _debugTask: ConsoleTask | null,
): void {}

export function logRecoveredRenderPhase(
  _startTime: number,
  _endTime: number,
  _lanes: Lanes,
  _recoverableErrors: CapturedValue<unknown>[],
  _hydrationFailed: boolean,
  _debugTask: ConsoleTask | null,
): void {}

export function logErroredRenderPhase(
  _startTime: number,
  _endTime: number,
  _lanes: Lanes,
  _debugTask: ConsoleTask | null,
): void {}

export function logInconsistentRender(_startTime: number, _endTime: number, _debugTask: ConsoleTask | null): void {}

export function logSuspendedCommitPhase(
  _startTime: number,
  _endTime: number,
  _reason: string,
  _debugTask: ConsoleTask | null,
): void {}

export function logSuspendedViewTransitionPhase(
  _startTime: number,
  _endTime: number,
  _reason: string,
  _debugTask: ConsoleTask | null,
): void {}

export function logCommitErrored(
  _startTime: number,
  _endTime: number,
  _errors: CapturedValue<unknown>[],
  _passive: boolean,
  _debugTask: ConsoleTask | null,
): void {}

export function logCommitPhase(
  _startTime: number,
  _endTime: number,
  _errors: CapturedValue<unknown>[] | null,
  _abortedViewTransition: boolean,
  _debugTask: ConsoleTask | null,
): void {}

export function logPaintYieldPhase(
  _startTime: number,
  _endTime: number,
  _delayedUntilPaint: boolean,
  _debugTask: ConsoleTask | null,
): void {}

export function logApplyGesturePhase(_startTime: number, _endTime: number, _debugTask: ConsoleTask | null): void {}

export function logStartViewTransitionYieldPhase(
  _startTime: number,
  _endTime: number,
  _abortedViewTransition: boolean,
  _debugTask: ConsoleTask | null,
): void {}

export function logAnimatingPhase(_startTime: number, _endTime: number, _debugTask: ConsoleTask | null): void {}

export function logPassiveCommitPhase(
  _startTime: number,
  _endTime: number,
  _errors: CapturedValue<unknown>[] | null,
  _debugTask: ConsoleTask | null,
): void {}
