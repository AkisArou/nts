// The scheduler over the browser's own prioritized task scheduling API
// (`scheduler.postTask`). Priorities map onto the browser's three; the
// browser decides ordering and yielding.

import {
  IdlePriority,
  ImmediatePriority,
  LowPriority,
  NormalPriority,
  type PriorityLevel,
  UserBlockingPriority,
} from "./Priorities.ts";

// The browser's `scheduler.yield` accepts an abort signal (the spec's form,
// and upstream passes one) although TypeScript's DOM types declare it with
// no parameters. A function taking fewer parameters is assignable to this
// wider type, so the signal is passed without a cast.
type YieldWithSignal = (this: Scheduler, options: { signal: AbortSignal }) => Promise<void>;

export type Callback = (didTimeout: boolean) => Callback | null | undefined;

export interface CallbackNode {
  readonly controller: TaskController;
}

// Captured when the module loads, as upstream does.
const perf = window.performance;
const localSetTimeout = window.setTimeout;
const browserScheduler = globalThis.scheduler;
const getCurrentTime = (): number => perf.now();

export const unstable_now = getCurrentTime;

// The browser does not tell a task how long it may run, so each task gets a
// fixed slice.
const yieldInterval = 5;
let deadline = 0;

let currentPriorityLevel: PriorityLevel = NormalPriority;

export function unstable_shouldYield(): boolean {
  return getCurrentTime() >= deadline;
}

export function unstable_requestPaint(): void {
  // The browser paints between its own tasks.
}

function postTaskPriorityOf(priorityLevel: PriorityLevel): TaskPriority {
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
      return "user-blocking";
    case IdlePriority:
      return "background";
    default:
      return "user-visible";
  }
}

export function unstable_scheduleCallback(
  priorityLevel: PriorityLevel,
  callback: Callback,
  options?: { delay?: number } | null,
): CallbackNode {
  const priority = postTaskPriorityOf(priorityLevel);
  const controller = new TaskController({ priority });
  const node: CallbackNode = { controller };
  browserScheduler
    .postTask(() => runTask(priorityLevel, node, callback), {
      delay: typeof options === "object" && options !== null ? options.delay : 0,
      signal: controller.signal,
    })
    .catch(handleAbortError);
  return node;
}

function runTask(priorityLevel: PriorityLevel, node: CallbackNode, callback: Callback): void {
  deadline = getCurrentTime() + yieldInterval;
  try {
    currentPriorityLevel = priorityLevel;
    const result = callback(false);
    if (typeof result === "function") {
      const nextTask = () => runTask(priorityLevel, node, result);
      const options = { signal: node.controller.signal };
      const yieldWithSignal: YieldWithSignal | undefined = browserScheduler.yield;
      if (yieldWithSignal !== undefined) {
        yieldWithSignal.call(browserScheduler, options).then(nextTask).catch(handleAbortError);
      } else {
        browserScheduler.postTask(nextTask, options).catch(handleAbortError);
      }
    }
  } catch (error) {
    // Inside a `postTask` promise an error would surface as an unhandled
    // rejection. Rethrowing it from an ordinary task gives it the default
    // error reporting that other tasks get.
    localSetTimeout(() => {
      throw error;
    });
  } finally {
    currentPriorityLevel = NormalPriority;
  }
}

// Abort errors are an implementation detail: neither the controller nor the
// promise is exposed, so the user has no way to handle them.
function handleAbortError(_error: unknown): void {}

export function unstable_cancelCallback(node: CallbackNode): void {
  node.controller.abort();
}

export function unstable_runWithPriority<T>(priorityLevel: PriorityLevel, callback: () => T): T {
  const previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;
  try {
    return callback();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

export function unstable_getCurrentPriorityLevel(): PriorityLevel {
  return currentPriorityLevel;
}

export function unstable_next<T>(callback: () => T): T {
  const priorityLevel =
    currentPriorityLevel === ImmediatePriority ||
    currentPriorityLevel === UserBlockingPriority ||
    currentPriorityLevel === NormalPriority
      ? NormalPriority
      : currentPriorityLevel;
  const previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;
  try {
    return callback();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

export function unstable_wrapCallback<T>(callback: () => T): () => T {
  const parentPriorityLevel = currentPriorityLevel;
  return () => {
    const previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = parentPriorityLevel;
    try {
      return callback();
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  };
}

export function unstable_forceFrameRate(): void {}

export const unstable_Profiling = null;

export {
  IdlePriority as unstable_IdlePriority,
  ImmediatePriority as unstable_ImmediatePriority,
  LowPriority as unstable_LowPriority,
  NormalPriority as unstable_NormalPriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
};
