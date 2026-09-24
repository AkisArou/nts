// The deterministic scheduler React's tests drive: time only moves when a
// test advances it, and work only runs when a test flushes it. Its public
// surface is upstream's `scheduler/unstable_mock`, which `internal-test-utils`
// (`waitFor`, `assertLog`, ...) is written against.

import {
  IdlePriority,
  ImmediatePriority,
  LowPriority,
  NormalPriority,
  type PriorityLevel,
  UserBlockingPriority,
  timeoutFor,
} from "./Priorities.ts";
import { peek, pop, push } from "./MinHeap.ts";
import { type Callback, Task } from "./Task.ts";

type HostCallback = (hasTimeRemaining: boolean, initialTime: number) => boolean;
type HostTimeout = (currentTime: number) => void;

const taskQueue: Task[] = [];
const timerQueue: Task[] = [];
let taskIdCounter = 1;

let currentPriorityLevel: PriorityLevel = NormalPriority;

// Set while performing work, to prevent re-entrance.
let isPerformingWork = false;
let isHostCallbackScheduled = false;
let isHostTimeoutScheduled = false;

let currentMockTime = 0;
let scheduledCallback: HostCallback | null = null;
let scheduledTimeout: HostTimeout | null = null;
let timeoutTime = -1;
let yieldedValues: unknown[] | null = null;
let expectedNumberOfYields = -1;
let didStop = false;
let isFlushing = false;
let needsPaint = false;
let shouldYieldForPaint = false;
let disableYieldValue = false;

function advanceTimers(currentTime: number): void {
  // Move timers that are no longer delayed into the task queue.
  let timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);
    } else {
      return;
    }
    timer = peek(timerQueue);
  }
}

function handleTimeout(currentTime: number): void {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);
  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    } else {
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

function flushWork(hasTimeRemaining: boolean, initialTime: number): boolean {
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }
  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel;
  try {
    return workLoop(hasTimeRemaining, initialTime);
  } finally {
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
  }
}

function workLoop(hasTimeRemaining: boolean, initialTime: number): boolean {
  let currentTime = initialTime;
  advanceTimers(currentTime);
  let task = peek(taskQueue);
  while (task !== null) {
    if (task.expirationTime > currentTime && (!hasTimeRemaining || shouldYieldToHost())) {
      // This task has not expired and we reached the deadline.
      break;
    }
    // `typeof`, not a null check: JavaScript callers can pass anything, and
    // upstream skips a task whose callback is not a function.
    const callback = task.callback;
    if (typeof callback === "function") {
      task.callback = null;
      currentPriorityLevel = task.priorityLevel;
      const didUserCallbackTimeout = task.expirationTime <= currentTime;
      const continuation = callback(didUserCallbackTimeout);
      currentTime = currentMockTime;
      if (typeof continuation === "function") {
        // A continuation yields to the host whatever time is left, but the
        // mock only does so while flushing until the next paint. Otherwise
        // it keeps flushing synchronously, which is what `waitFor` and
        // `waitForAll` expect.
        task.callback = continuation;
        advanceTimers(currentTime);
        if (shouldYieldForPaint) {
          needsPaint = true;
          return true;
        }
      } else {
        if (task === peek(taskQueue)) {
          pop(taskQueue);
        }
        advanceTimers(currentTime);
      }
    } else {
      pop(taskQueue);
    }
    task = peek(taskQueue);
  }
  if (task !== null) {
    return true;
  }
  const firstTimer = peek(timerQueue);
  if (firstTimer !== null) {
    requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
  }
  return false;
}

export function unstable_runWithPriority<T>(priorityLevel: PriorityLevel, eventHandler: () => T): T {
  const level = isPriorityLevel(priorityLevel) ? priorityLevel : NormalPriority;
  const previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = level;
  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

export function unstable_next<T>(eventHandler: () => T): T {
  // Anything at normal priority or above shifts down to normal; anything
  // lower keeps its level.
  const priorityLevel =
    currentPriorityLevel === ImmediatePriority ||
    currentPriorityLevel === UserBlockingPriority ||
    currentPriorityLevel === NormalPriority
      ? NormalPriority
      : currentPriorityLevel;
  const previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;
  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

export function unstable_wrapCallback<A extends unknown[], R>(
  callback: (...args: A) => R,
): (...args: A) => R {
  const parentPriorityLevel = currentPriorityLevel;
  return (...args: A): R => {
    const previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = parentPriorityLevel;
    try {
      return callback(...args);
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  };
}

export function unstable_scheduleCallback(
  priorityLevel: PriorityLevel,
  callback: Callback,
  options?: {delay?: number} | null,
): Task {
  const currentTime = currentMockTime;
  const delay = options == null ? undefined : options.delay;
  const startTime = typeof delay === "number" && delay > 0 ? currentTime + delay : currentTime;
  const newTask = new Task(
    taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    startTime + timeoutFor(priorityLevel),
  );
  if (startTime > currentTime) {
    // A delayed task.
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // Every task is delayed and this one is the earliest.
      if (isHostTimeoutScheduled) {
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    newTask.sortIndex = newTask.expirationTime;
    push(taskQueue, newTask);
    // If work is already being performed, wait until it next yields.
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    }
  }
  return newTask;
}

export function unstable_cancelCallback(task: Task): void {
  task.callback = null;
}

export function unstable_getCurrentPriorityLevel(): PriorityLevel {
  return currentPriorityLevel;
}

function requestHostCallback(callback: HostCallback): void {
  scheduledCallback = callback;
}

function requestHostTimeout(callback: HostTimeout, ms: number): void {
  scheduledTimeout = callback;
  timeoutTime = currentMockTime + ms;
}

function cancelHostTimeout(): void {
  scheduledTimeout = null;
  timeoutTime = -1;
}

export function unstable_shouldYield(): boolean {
  return shouldYieldToHost();
}

function shouldYieldToHost(): boolean {
  if (
    (expectedNumberOfYields === 0 && yieldedValues === null) ||
    (expectedNumberOfYields !== -1 &&
      yieldedValues !== null &&
      yieldedValues.length >= expectedNumberOfYields) ||
    (shouldYieldForPaint && needsPaint)
  ) {
    // At least as many values were yielded as expected: stop flushing.
    didStop = true;
    return true;
  }
  return false;
}

export function unstable_now(): number {
  return currentMockTime;
}

export function unstable_forceFrameRate(_fps: number): void {}

export function unstable_requestPaint(): void {
  needsPaint = true;
}

export function reset(): void {
  if (isFlushing) {
    throw new Error("Cannot reset while already flushing work.");
  }
  currentMockTime = 0;
  scheduledCallback = null;
  scheduledTimeout = null;
  timeoutTime = -1;
  yieldedValues = null;
  expectedNumberOfYields = -1;
  didStop = false;
  isFlushing = false;
  needsPaint = false;
}

// Only for assertion helpers that then inspect the yielded values.
export function unstable_flushNumberOfYields(count: number): void {
  if (isFlushing) {
    throw new Error("Already flushing work.");
  }
  const callback = scheduledCallback;
  if (callback === null) {
    return;
  }
  expectedNumberOfYields = count;
  isFlushing = true;
  try {
    let hasMoreWork = true;
    do {
      hasMoreWork = callback(true, currentMockTime);
    } while (hasMoreWork && !didStop);
    if (!hasMoreWork) {
      scheduledCallback = null;
    }
  } finally {
    expectedNumberOfYields = -1;
    didStop = false;
    isFlushing = false;
  }
}

export function unstable_flushUntilNextPaint(): false {
  if (isFlushing) {
    throw new Error("Already flushing work.");
  }
  const callback = scheduledCallback;
  if (callback !== null) {
    shouldYieldForPaint = true;
    needsPaint = false;
    isFlushing = true;
    try {
      let hasMoreWork = true;
      do {
        hasMoreWork = callback(true, currentMockTime);
      } while (hasMoreWork && !didStop);
      if (!hasMoreWork) {
        scheduledCallback = null;
      }
    } finally {
      shouldYieldForPaint = false;
      didStop = false;
      isFlushing = false;
    }
  }
  return false;
}

export function unstable_hasPendingWork(): boolean {
  return scheduledCallback !== null;
}

export function unstable_flushExpired(): void {
  if (isFlushing) {
    throw new Error("Already flushing work.");
  }
  const callback = scheduledCallback;
  if (callback !== null) {
    isFlushing = true;
    try {
      if (!callback(false, currentMockTime)) {
        scheduledCallback = null;
      }
    } finally {
      isFlushing = false;
    }
  }
}

// Returns false when there was no work to flush.
export function unstable_flushAllWithoutAsserting(): boolean {
  if (isFlushing) {
    throw new Error("Already flushing work.");
  }
  const callback = scheduledCallback;
  if (callback === null) {
    return false;
  }
  isFlushing = true;
  try {
    while (callback(true, currentMockTime)) {}
    scheduledCallback = null;
    return true;
  } finally {
    isFlushing = false;
  }
}

export function unstable_clearLog(): unknown[] {
  const values = yieldedValues;
  yieldedValues = null;
  return values === null ? [] : values;
}

export function unstable_flushAll(): void {
  if (yieldedValues !== null) {
    throw new Error(
      "Log is not empty. Assert on the log of yielded values before " +
        "flushing additional work.",
    );
  }
  unstable_flushAllWithoutAsserting();
  if (yieldedValues !== null) {
    throw new Error(
      "While flushing work, something yielded a value. Use an " +
        "assertion helper to assert on the log of yielded values, e.g. " +
        "expect(Scheduler).toFlushAndYield([...])",
    );
  }
}

// While React replays a render in development (StrictMode's second pass) it
// swaps `console.log` for a function named `disabledLog`. Values logged then
// are ignored, as are advances of time.
function isReplaying(): boolean {
  return disableYieldValue || console.log.name === "disabledLog";
}

export function log(value: unknown): void {
  if (isReplaying()) {
    return;
  }
  if (yieldedValues === null) {
    yieldedValues = [value];
  } else {
    yieldedValues.push(value);
  }
}

export function unstable_advanceTime(ms: number): void {
  if (isReplaying()) {
    return;
  }
  currentMockTime += ms;
  const timeout = scheduledTimeout;
  if (timeout !== null && timeoutTime <= currentMockTime) {
    timeout(currentMockTime);
    timeoutTime = -1;
    scheduledTimeout = null;
  }
}

export function unstable_setDisableYieldValue(newValue: boolean): void {
  disableYieldValue = newValue;
}

function isPriorityLevel(level: number): level is PriorityLevel {
  return (
    level === ImmediatePriority ||
    level === UserBlockingPriority ||
    level === NormalPriority ||
    level === LowPriority ||
    level === IdlePriority
  );
}

export const unstable_Profiling = null;

export {
  IdlePriority as unstable_IdlePriority,
  ImmediatePriority as unstable_ImmediatePriority,
  LowPriority as unstable_LowPriority,
  NormalPriority as unstable_NormalPriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
};
