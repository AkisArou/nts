// Logging to the browser's performance timeline: Chrome's "Components ⚛"
// track (one entry per component render, effect and error) and the
// "Scheduler ⚛" track group (one track per lane group, with the phases of
// each render and commit). Entries go through `console.timeStamp`, and in
// development through `performance.measure` when they carry properties such
// as which props changed.
//
// In development each call runs inside the fiber's `console.createTask`
// task when there is one, so the timeline links the entry to the component
// that caused it.

import { isDevelopment } from "shared/Build.ts";
import { enableGestureTransition, enablePerformanceIssueReporting, enableProfilerTimer } from "shared/ReactFeatureFlags.ts";
import {
  addObjectDiffToProperties,
  addObjectToProperties,
  addValueToProperties,
  type PropertyRow,
} from "shared/ReactPerformanceTrackProperties.ts";
import type { CapturedValue } from "react-reconciler/ReactCapturedValue.ts";
import type { Lanes } from "./ReactFiberLane.ts";
import {
  getGroupNameOfHighestPriorityLane,
  includesOnlyHydrationLanes,
  includesOnlyHydrationOrOffscreenLanes,
  includesOnlyOffscreenLanes,
  includesSomeLane,
} from "./ReactFiberLane.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import { SuspenseComponent } from "./ReactWorkTags.ts";
import { getComponentNameFromFiber } from "./getComponentNameFromFiber.ts";

// Chrome's extended `console.timeStamp(label, start, end, track, trackGroup,
// color)`, which the standard typings declare with only a label.
declare global {
  interface Console {
    timeStamp(
      label: string,
      start: number,
      end: number,
      trackName: string,
      trackGroup: string | undefined,
      color: string,
    ): void;
  }
}

// `console.createTask`'s task. Fibers carry it as an opaque value.
interface ConsoleTask {
  run<T>(callback: () => T): T;
}
type DebugTask = ConsoleTask | null | undefined;

// JS object model: a fiber's `_debugTask` is whatever console.createTask
// returned, a task with `run`, or null when there is none.
function taskOf(value: unknown): DebugTask {
  return value as DebugTask;
}

const supportsUserTiming =
  enableProfilerTimer &&
  typeof console !== "undefined" &&
  typeof console.timeStamp === "function" &&
  // In development we also rely on performance.measure.
  (!isDevelopment || (typeof performance !== "undefined" && typeof performance.measure === "function"));

const COMPONENTS_TRACK = "Components ⚛";
const LANES_TRACK_GROUP = "Scheduler ⚛";

// The lane group the next render is logged under.
let currentTrack: string = "Blocking";

export function setCurrentTrackFromLanes(lanes: Lanes): void {
  currentTrack = getGroupNameOfHighestPriorityLane(lanes);
}

export function getCurrentTrack(): string {
  return currentTrack;
}

// A `console.timeStamp` entry, run inside the debug task in development.
function timeStamp(
  debugTask: DebugTask,
  label: string,
  startTime: number,
  endTime: number,
  track: string,
  trackGroup: string | undefined,
  color: string,
): void {
  if (isDevelopment && debugTask) {
    debugTask.run(() => console.timeStamp(label, startTime, endTime, track, trackGroup, color));
  } else {
    console.timeStamp(label, startTime, endTime, track, trackGroup, color);
  }
}

// A `performance.measure` entry, run inside the debug task, and then
// cleared: only the timeline recording matters.
function measure(debugTask: DebugTask, name: string, options: PerformanceMeasureOptions): void {
  if (debugTask) {
    debugTask.run(() => performance.measure(name, options));
  } else {
    performance.measure(name, options);
  }
  performance.clearMeasures(name);
}

function errorMessageOf(error: unknown): string {
  return typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
    ? String((error as { message: string }).message)
    : String(error);
}

export function markAllLanesInOrder(): void {
  if (supportsUserTiming) {
    // Ensure we create all tracks in priority order. performance.mark() are
    // in first insertion order but performance.measure() are in the reverse
    // order. We can always add the 0 time slot even if it's in the past;
    // that's still considered for ordering.
    console.timeStamp("Blocking Track", 0.003, 0.003, "Blocking", LANES_TRACK_GROUP, "primary-light");
    if (enableGestureTransition) {
      console.timeStamp("Gesture Track", 0.003, 0.003, "Gesture", LANES_TRACK_GROUP, "primary-light");
    }
    console.timeStamp("Transition Track", 0.003, 0.003, "Transition", LANES_TRACK_GROUP, "primary-light");
    console.timeStamp("Suspense Track", 0.003, 0.003, "Suspense", LANES_TRACK_GROUP, "primary-light");
    console.timeStamp("Idle Track", 0.003, 0.003, "Idle", LANES_TRACK_GROUP, "primary-light");
  }
}

// Reused for every component entry; `performance.measure` copies what it
// needs. Tests observe that the same objects are passed each time.
const reusableComponentDevToolDetails: {
  color: string;
  properties: PropertyRow[] | null;
  tooltipText: string;
  track: string;
} = {
  color: "primary",
  properties: null,
  tooltipText: "",
  track: COMPONENTS_TRACK,
};

const reusableComponentOptions: { start: number; end: number; detail: { devtools: typeof reusableComponentDevToolDetails } } =
  {
    start: -0,
    end: -0,
    detail: {
      devtools: reusableComponentDevToolDetails,
    },
  };

function logComponentTrigger(fiber: Fiber, startTime: number, endTime: number, trigger: string): void {
  if (supportsUserTiming) {
    reusableComponentOptions.start = startTime;
    reusableComponentOptions.end = endTime;
    reusableComponentDevToolDetails.color = "warning";
    reusableComponentDevToolDetails.tooltipText = trigger;
    reusableComponentDevToolDetails.properties = null;
    measure(isDevelopment ? taskOf(fiber._debugTask) : null, trigger, reusableComponentOptions);
  }
}

export function logComponentMount(fiber: Fiber, startTime: number, endTime: number): void {
  logComponentTrigger(fiber, startTime, endTime, "Mount");
}

export function logComponentUnmount(fiber: Fiber, startTime: number, endTime: number): void {
  logComponentTrigger(fiber, startTime, endTime, "Unmount");
}

export function logComponentReappeared(fiber: Fiber, startTime: number, endTime: number): void {
  logComponentTrigger(fiber, startTime, endTime, "Reconnect");
}

export function logComponentDisappeared(fiber: Fiber, startTime: number, endTime: number): void {
  logComponentTrigger(fiber, startTime, endTime, "Disconnect");
}

// Whether a parent already warned about deeply equal props in this subtree.
let alreadyWarnedForDeepEquality = false;

export function pushDeepEquality(): boolean {
  if (isDevelopment) {
    // If this is true then we don't reset it to false because we're tracking
    // if any parent already warned about having deep equality props in this
    // subtree.
    return alreadyWarnedForDeepEquality;
  }
  return false;
}

export function popDeepEquality(prev: boolean): void {
  if (isDevelopment) {
    alreadyWarnedForDeepEquality = prev;
  }
}

const reusableChangedPropsEntry: PropertyRow = ["Changed Props", ""];

const reusableCascadingUpdateIssue = {
  name: "React: Cascading Update",
  severity: "warning",
  description:
    "A cascading update is an update that is triggered during an ongoing render. This can lead to performance issues.",
  learnMoreUrl: "https://react.dev/reference/dev-tools/react-performance-tracks#cascading-updates",
};

const DEEP_EQUALITY_WARNING =
  "This component received deeply equal props. It might benefit from useMemo or the React Compiler in its owner.";

const reusableDeeplyEqualPropsEntry: PropertyRow = ["Changed Props", DEEP_EQUALITY_WARNING];

export function logComponentRender(
  fiber: Fiber,
  startTime: number,
  endTime: number,
  wasHydrated: boolean,
  committedLanes: Lanes,
): void {
  const name = getComponentNameFromFiber(fiber);
  if (name === null) {
    // Skip.
    return;
  }
  if (!supportsUserTiming) {
    return;
  }
  const alternate = fiber.alternate;
  let selfTime = fiber.actualDuration;
  if (alternate === null || alternate.child !== fiber.child) {
    for (let child = fiber.child; child !== null; child = child.sibling) {
      selfTime -= child.actualDuration;
    }
  }
  const color =
    selfTime < 0.5
      ? wasHydrated
        ? "tertiary-light"
        : "primary-light"
      : selfTime < 10
        ? wasHydrated
          ? "tertiary"
          : "primary"
        : selfTime < 100
          ? wasHydrated
            ? "tertiary-dark"
            : "primary-dark"
          : "error";

  if (!isDevelopment) {
    console.timeStamp(name, startTime, endTime, COMPONENTS_TRACK, undefined, color);
    return;
  }
  const props = fiber.memoizedProps;
  const debugTask = taskOf(fiber._debugTask);
  if (props !== null && alternate !== null && alternate.memoizedProps !== props) {
    // An update: diff the props and emit which ones changed.
    const properties: PropertyRow[] = [reusableChangedPropsEntry];
    const isDeeplyEqual = addObjectDiffToProperties(
      alternate.memoizedProps as object,
      props as object,
      properties,
      0,
    );
    if (properties.length > 1) {
      if (
        isDeeplyEqual &&
        !alreadyWarnedForDeepEquality &&
        !includesSomeLane(alternate.lanes, committedLanes) &&
        fiber.actualDuration > 100
      ) {
        alreadyWarnedForDeepEquality = true;
        // This is the first component in a subtree which rerendered with
        // deeply equal props and didn't have its own work scheduled and took
        // a non-trivial amount of time. We highlight this for inspection.
        // properties.length > 1 only when a diff was emitted, which happens
        // only for nested equal objects, so simple shallow equality does not
        // warn.
        properties[0] = reusableDeeplyEqualPropsEntry;
        reusableComponentDevToolDetails.color = "warning";
        reusableComponentDevToolDetails.tooltipText = DEEP_EQUALITY_WARNING;
      } else {
        reusableComponentDevToolDetails.color = color;
        reusableComponentDevToolDetails.tooltipText = name;
      }
      reusableComponentDevToolDetails.properties = properties;
      reusableComponentOptions.start = startTime;
      reusableComponentOptions.end = endTime;
      measure(debugTask, "​" + name, reusableComponentOptions);
      return;
    }
  }
  timeStamp(debugTask, name, startTime, endTime, COMPONENTS_TRACK, undefined, color);
}

export function logComponentErrored(
  fiber: Fiber,
  startTime: number,
  endTime: number,
  errors: CapturedValue<unknown>[],
): void {
  if (!supportsUserTiming) {
    return;
  }
  const name = getComponentNameFromFiber(fiber);
  if (name === null) {
    // Skip.
    return;
  }
  if (!isDevelopment) {
    console.timeStamp(name, startTime, endTime, COMPONENTS_TRACK, undefined, "error");
    return;
  }
  let debugTask: DebugTask = null;
  const properties: PropertyRow[] = [];
  for (let i = 0; i < errors.length; i++) {
    const capturedValue = errors[i]!;
    if (debugTask == null && capturedValue.source !== null) {
      // If the captured value has a source fiber, use its task for the
      // stack instead of the error boundary's, so you can find which
      // component errored since we don't show the errored render tree.
      debugTask = taskOf(capturedValue.source._debugTask);
    }
    properties.push(["Error", errorMessageOf(capturedValue.value)]);
  }
  if (fiber.key !== null) {
    addValueToProperties("key", fiber.key, properties, 0, "");
  }
  if (fiber.memoizedProps !== null) {
    addObjectToProperties(fiber.memoizedProps as object, properties, 0, "");
  }
  if (debugTask == null) {
    // If the captured values don't have a task, fall back to the error
    // boundary itself.
    debugTask = taskOf(fiber._debugTask);
  }
  const options: PerformanceMeasureOptions = {
    start: startTime,
    end: endTime,
    detail: {
      devtools: {
        color: "error",
        track: COMPONENTS_TRACK,
        tooltipText: fiber.tag === SuspenseComponent ? "Hydration failed" : "Error boundary caught an error",
        properties,
      },
    },
  };
  measure(debugTask, "​" + name, options);
}

function logComponentEffectErrored(
  fiber: Fiber,
  startTime: number,
  endTime: number,
  errors: CapturedValue<unknown>[],
): void {
  if (!supportsUserTiming) {
    return;
  }
  const name = getComponentNameFromFiber(fiber);
  if (name === null) {
    // Skip.
    return;
  }
  if (!isDevelopment) {
    console.timeStamp(name, startTime, endTime, COMPONENTS_TRACK, undefined, "error");
    return;
  }
  const properties: PropertyRow[] = [];
  for (let i = 0; i < errors.length; i++) {
    properties.push(["Error", errorMessageOf(errors[i]!.value)]);
  }
  if (fiber.key !== null) {
    addValueToProperties("key", fiber.key, properties, 0, "");
  }
  if (fiber.memoizedProps !== null) {
    addObjectToProperties(fiber.memoizedProps as object, properties, 0, "");
  }
  const options: PerformanceMeasureOptions = {
    start: startTime,
    end: endTime,
    detail: {
      devtools: {
        color: "error",
        track: COMPONENTS_TRACK,
        tooltipText: "A lifecycle or effect errored",
        properties,
      },
    },
  };
  measure(taskOf(fiber._debugTask), "​" + name, options);
}

export function logComponentEffect(
  fiber: Fiber,
  startTime: number,
  endTime: number,
  selfTime: number,
  errors: CapturedValue<unknown>[] | null,
): void {
  if (errors !== null) {
    logComponentEffectErrored(fiber, startTime, endTime, errors);
    return;
  }
  const name = getComponentNameFromFiber(fiber);
  if (name === null) {
    // Skip.
    return;
  }
  if (supportsUserTiming) {
    const color =
      selfTime < 1 ? "secondary-light" : selfTime < 100 ? "secondary" : selfTime < 500 ? "secondary-dark" : "error";
    timeStamp(taskOf(fiber._debugTask), name, startTime, endTime, COMPONENTS_TRACK, undefined, color);
  }
}

export function logYieldTime(startTime: number, endTime: number): void {
  if (supportsUserTiming) {
    const yieldDuration = endTime - startTime;
    if (yieldDuration < 3) {
      // Skip sub-millisecond yields. This happens all the time and is not
      // interesting.
      return;
    }
    // Being blocked on CPU is potentially bad so we color it by how long it
    // took.
    const color =
      yieldDuration < 5 ? "primary-light" : yieldDuration < 10 ? "primary" : yieldDuration < 100 ? "primary-dark" : "error";
    // This gets logged in the components track if we don't commit, which
    // leaves it hanging without context. It's a useful indicator for why
    // something might be starving this render though.
    console.timeStamp("Blocked", startTime, endTime, COMPONENTS_TRACK, undefined, color);
  }
}

export function logSuspendedYieldTime(startTime: number, endTime: number, suspendedFiber: Fiber): void {
  if (supportsUserTiming) {
    timeStamp(
      taskOf(suspendedFiber._debugTask),
      "Suspended",
      startTime,
      endTime,
      COMPONENTS_TRACK,
      undefined,
      "primary-light",
    );
  }
}

export function logActionYieldTime(startTime: number, endTime: number, suspendedFiber: Fiber): void {
  if (supportsUserTiming) {
    timeStamp(
      taskOf(suspendedFiber._debugTask),
      "Action",
      startTime,
      endTime,
      COMPONENTS_TRACK,
      undefined,
      "primary-light",
    );
  }
}

// The "Update" entry of a lane track: from setState to the start of the
// render, with the component and method that scheduled it.
function measureUpdate(
  debugTask: DebugTask,
  label: string,
  updateTime: number,
  renderStartTime: number,
  color: string,
  updateMethodName: string | null,
  updateComponentName: string | null,
  performanceIssue: typeof reusableCascadingUpdateIssue | null,
): void {
  const properties: PropertyRow[] = [];
  if (updateComponentName != null) {
    properties.push(["Component name", updateComponentName]);
  }
  if (updateMethodName != null) {
    properties.push(["Method name", updateMethodName]);
  }
  const devtools: {
    properties: PropertyRow[];
    track: string;
    trackGroup: string;
    color: string;
    performanceIssue?: typeof reusableCascadingUpdateIssue;
  } = {
    properties,
    track: currentTrack,
    trackGroup: LANES_TRACK_GROUP,
    color,
  };
  if (performanceIssue !== null) {
    devtools.performanceIssue = performanceIssue;
  }
  measure(debugTask, label, { start: updateTime, end: renderStartTime, detail: { devtools } });
}

export function logBlockingStart(
  updateTime: number,
  eventTime: number,
  eventType: string | null,
  eventIsRepeat: boolean,
  isSpawnedUpdate: boolean,
  isPingedUpdate: boolean,
  renderStartTime: number,
  lanes: Lanes,
  debugTask: unknown,
  updateMethodName: string | null,
  updateComponentName: string | null,
): void {
  if (!supportsUserTiming) {
    return;
  }
  const task = taskOf(debugTask);
  currentTrack = "Blocking";
  // Clamp start times.
  if (updateTime > 0) {
    if (updateTime > renderStartTime) {
      updateTime = renderStartTime;
    }
  } else {
    updateTime = renderStartTime;
  }
  if (eventTime > 0) {
    if (eventTime > updateTime) {
      eventTime = updateTime;
    }
  } else {
    eventTime = updateTime;
  }
  // If a blocking update was spawned within render or an effect, that's
  // considered a cascading render. A second blocking update within the same
  // event suggests multiple flushSync or setState in a microtask, which is
  // also considered a cascade.
  if (eventType !== null && updateTime > eventTime) {
    // Log the time from the event timeStamp until we called setState.
    const color = eventIsRepeat ? "secondary-light" : "warning";
    timeStamp(
      task,
      eventIsRepeat ? "Consecutive" : "Event: " + eventType,
      eventTime,
      updateTime,
      currentTrack,
      LANES_TRACK_GROUP,
      color,
    );
  }
  if (renderStartTime > updateTime) {
    // Log the time from when we called setState until we started rendering.
    const color = isSpawnedUpdate
      ? "error"
      : includesOnlyHydrationOrOffscreenLanes(lanes)
        ? "tertiary-light"
        : "primary-light";
    const label = isPingedUpdate
      ? "Promise Resolved"
      : isSpawnedUpdate
        ? "Cascading Update"
        : renderStartTime - updateTime > 5
          ? "Update Blocked"
          : "Update";
    if (isDevelopment) {
      measureUpdate(
        task,
        label,
        updateTime,
        renderStartTime,
        color,
        updateMethodName,
        updateComponentName,
        enablePerformanceIssueReporting && isSpawnedUpdate ? reusableCascadingUpdateIssue : null,
      );
    } else {
      console.timeStamp(label, updateTime, renderStartTime, currentTrack, LANES_TRACK_GROUP, color);
    }
  }
}

export function logGestureStart(
  updateTime: number,
  eventTime: number,
  eventType: string | null,
  eventIsRepeat: boolean,
  isPingedUpdate: boolean,
  renderStartTime: number,
  debugTask: unknown,
  updateMethodName: string | null,
  updateComponentName: string | null,
): void {
  if (!supportsUserTiming) {
    return;
  }
  const task = taskOf(debugTask);
  currentTrack = "Gesture";
  // Clamp start times.
  if (updateTime > 0) {
    if (updateTime > renderStartTime) {
      updateTime = renderStartTime;
    }
  } else {
    updateTime = renderStartTime;
  }
  if (eventTime > 0) {
    if (eventTime > updateTime) {
      eventTime = updateTime;
    }
  } else {
    eventTime = updateTime;
  }
  if (updateTime > eventTime && eventType !== null) {
    // Log the time from the event timeStamp until we started a gesture.
    const color = eventIsRepeat ? "secondary-light" : "warning";
    timeStamp(
      task,
      eventIsRepeat ? "Consecutive" : "Event: " + eventType,
      eventTime,
      updateTime,
      currentTrack,
      LANES_TRACK_GROUP,
      color,
    );
  }
  if (renderStartTime > updateTime) {
    // Log the time from when we called setState until we started rendering.
    const label = isPingedUpdate ? "Promise Resolved" : renderStartTime - updateTime > 5 ? "Gesture Blocked" : "Gesture";
    if (isDevelopment) {
      measureUpdate(task, label, updateTime, renderStartTime, "primary-light", updateMethodName, updateComponentName, null);
    } else {
      console.timeStamp(label, updateTime, renderStartTime, currentTrack, LANES_TRACK_GROUP, "primary-light");
    }
  }
}

export function logTransitionStart(
  startTime: number,
  updateTime: number,
  eventTime: number,
  eventType: string | null,
  eventIsRepeat: boolean,
  isPingedUpdate: boolean,
  renderStartTime: number,
  debugTask: unknown,
  updateMethodName: string | null,
  updateComponentName: string | null,
): void {
  if (!supportsUserTiming) {
    return;
  }
  const task = taskOf(debugTask);
  currentTrack = "Transition";
  // Clamp start times.
  if (updateTime > 0) {
    if (updateTime > renderStartTime) {
      updateTime = renderStartTime;
    }
  } else {
    updateTime = renderStartTime;
  }
  if (startTime > 0) {
    if (startTime > updateTime) {
      startTime = updateTime;
    }
  } else {
    startTime = updateTime;
  }
  if (eventTime > 0) {
    if (eventTime > startTime) {
      eventTime = startTime;
    }
  } else {
    eventTime = startTime;
  }
  if (startTime > eventTime && eventType !== null) {
    // Log the time from the event timeStamp until we started a transition.
    const color = eventIsRepeat ? "secondary-light" : "warning";
    timeStamp(
      task,
      eventIsRepeat ? "Consecutive" : "Event: " + eventType,
      eventTime,
      startTime,
      currentTrack,
      LANES_TRACK_GROUP,
      color,
    );
  }
  if (updateTime > startTime) {
    // Log the time from when we started an async transition until we called
    // setState or started rendering.
    timeStamp(task, "Action", startTime, updateTime, currentTrack, LANES_TRACK_GROUP, "primary-dark");
  }
  if (renderStartTime > updateTime) {
    // Log the time from when we called setState until we started rendering.
    const label = isPingedUpdate ? "Promise Resolved" : renderStartTime - updateTime > 5 ? "Update Blocked" : "Update";
    if (isDevelopment) {
      measureUpdate(task, label, updateTime, renderStartTime, "primary-light", updateMethodName, updateComponentName, null);
    } else {
      console.timeStamp(label, updateTime, renderStartTime, currentTrack, LANES_TRACK_GROUP, "primary-light");
    }
  }
}

// A phase of the current lane track, when it took any time.
function logLanePhase(
  debugTask: unknown,
  label: string,
  startTime: number,
  endTime: number,
  color: string,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    timeStamp(taskOf(debugTask), label, startTime, endTime, currentTrack, LANES_TRACK_GROUP, color);
  }
}

function renderPhaseColor(lanes: Lanes): string {
  return includesOnlyHydrationOrOffscreenLanes(lanes) ? "tertiary-dark" : "primary-dark";
}

export function logRenderPhase(startTime: number, endTime: number, lanes: Lanes, debugTask: unknown): void {
  const label = includesOnlyOffscreenLanes(lanes) ? "Prepared" : includesOnlyHydrationLanes(lanes) ? "Hydrated" : "Render";
  logLanePhase(debugTask, label, startTime, endTime, renderPhaseColor(lanes));
}

export function logInterruptedRenderPhase(startTime: number, endTime: number, lanes: Lanes, debugTask: unknown): void {
  const label = includesOnlyOffscreenLanes(lanes)
    ? "Prewarm"
    : includesOnlyHydrationLanes(lanes)
      ? "Interrupted Hydration"
      : "Interrupted Render";
  logLanePhase(debugTask, label, startTime, endTime, renderPhaseColor(lanes));
}

export function logSuspendedRenderPhase(startTime: number, endTime: number, lanes: Lanes, debugTask: unknown): void {
  logLanePhase(debugTask, "Prewarm", startTime, endTime, renderPhaseColor(lanes));
}

// The render was suspended and cannot commit until it gets unblocked.
export function logSuspendedWithDelayPhase(startTime: number, endTime: number, lanes: Lanes, debugTask: unknown): void {
  logLanePhase(debugTask, "Suspended", startTime, endTime, renderPhaseColor(lanes));
}

export function logRecoveredRenderPhase(
  startTime: number,
  endTime: number,
  _lanes: Lanes,
  recoverableErrors: CapturedValue<unknown>[],
  hydrationFailed: boolean,
  debugTask: unknown,
): void {
  if (!supportsUserTiming) {
    return;
  }
  if (endTime <= startTime) {
    return;
  }
  if (!isDevelopment) {
    console.timeStamp("Recovered", startTime, endTime, currentTrack, LANES_TRACK_GROUP, "error");
    return;
  }
  const properties: PropertyRow[] = [];
  for (let i = 0; i < recoverableErrors.length; i++) {
    properties.push(["Recoverable Error", errorMessageOf(recoverableErrors[i]!.value)]);
  }
  const options: PerformanceMeasureOptions = {
    start: startTime,
    end: endTime,
    detail: {
      devtools: {
        color: "primary-dark",
        track: currentTrack,
        trackGroup: LANES_TRACK_GROUP,
        tooltipText: hydrationFailed ? "Hydration Failed" : "Recovered after Error",
        properties,
      },
    },
  };
  measure(taskOf(debugTask), "Recovered", options);
}

export function logErroredRenderPhase(startTime: number, endTime: number, _lanes: Lanes, debugTask: unknown): void {
  logLanePhase(debugTask, "Errored", startTime, endTime, "error");
}

export function logInconsistentRender(startTime: number, endTime: number, debugTask: unknown): void {
  logLanePhase(debugTask, "Teared Render", startTime, endTime, "error");
}

// The commit was suspended on CSS or images.
export function logSuspendedCommitPhase(startTime: number, endTime: number, reason: string, debugTask: unknown): void {
  logLanePhase(debugTask, reason, startTime, endTime, "secondary-light");
}

export function logSuspendedViewTransitionPhase(
  startTime: number,
  endTime: number,
  reason: string,
  debugTask: unknown,
): void {
  logLanePhase(debugTask, reason, startTime, endTime, "secondary-light");
}

export function logCommitErrored(
  startTime: number,
  endTime: number,
  errors: CapturedValue<unknown>[],
  passive: boolean,
  debugTask: unknown,
): void {
  if (!supportsUserTiming) {
    return;
  }
  if (endTime <= startTime) {
    return;
  }
  if (!isDevelopment) {
    console.timeStamp("Errored", startTime, endTime, currentTrack, LANES_TRACK_GROUP, "error");
    return;
  }
  const properties: PropertyRow[] = [];
  for (let i = 0; i < errors.length; i++) {
    properties.push(["Error", errorMessageOf(errors[i]!.value)]);
  }
  const options: PerformanceMeasureOptions = {
    start: startTime,
    end: endTime,
    detail: {
      devtools: {
        color: "error",
        track: currentTrack,
        trackGroup: LANES_TRACK_GROUP,
        tooltipText: passive ? "Remaining Effects Errored" : "Commit Errored",
        properties,
      },
    },
  };
  measure(taskOf(debugTask), "Errored", options);
}

export function logCommitPhase(
  startTime: number,
  endTime: number,
  errors: CapturedValue<unknown>[] | null,
  abortedViewTransition: boolean,
  debugTask: unknown,
): void {
  if (errors !== null) {
    logCommitErrored(startTime, endTime, errors, false, debugTask);
    return;
  }
  logLanePhase(
    debugTask,
    abortedViewTransition ? "Commit Interrupted View Transition" : "Commit",
    startTime,
    endTime,
    abortedViewTransition ? "error" : "secondary-dark",
  );
}

export function logPaintYieldPhase(
  startTime: number,
  endTime: number,
  delayedUntilPaint: boolean,
  debugTask: unknown,
): void {
  logLanePhase(debugTask, delayedUntilPaint ? "Waiting for Paint" : "Waiting", startTime, endTime, "secondary-light");
}

export function logApplyGesturePhase(startTime: number, endTime: number, debugTask: unknown): void {
  logLanePhase(debugTask, "Create Ghost Tree", startTime, endTime, "secondary-dark");
}

export function logStartViewTransitionYieldPhase(
  startTime: number,
  endTime: number,
  abortedViewTransition: boolean,
  debugTask: unknown,
): void {
  if (!supportsUserTiming) {
    return;
  }
  if (endTime <= startTime) {
    return;
  }
  const label = abortedViewTransition ? "Interrupted View Transition" : "Starting Animation";
  const task = taskOf(debugTask);
  if (isDevelopment && task) {
    task.run(() =>
      console.timeStamp(
        label,
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        abortedViewTransition ? "error" : "secondary-light",
      ),
    );
  } else {
    // Upstream's colour here has a leading space; kept verbatim.
    console.timeStamp(
      label,
      startTime,
      endTime,
      currentTrack,
      LANES_TRACK_GROUP,
      abortedViewTransition ? " error" : "secondary-light",
    );
  }
}

export function logAnimatingPhase(startTime: number, endTime: number, debugTask: unknown): void {
  logLanePhase(debugTask, "Animating", startTime, endTime, "secondary-dark");
}

export function logPassiveCommitPhase(
  startTime: number,
  endTime: number,
  errors: CapturedValue<unknown>[] | null,
  debugTask: unknown,
): void {
  if (errors !== null) {
    logCommitErrored(startTime, endTime, errors, true, debugTask);
    return;
  }
  logLanePhase(debugTask, "Remaining Effects", startTime, endTime, "secondary-dark");
}
