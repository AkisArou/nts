// The production scheduler: runs tasks in priority order, in slices of about
// five milliseconds, yielding to the host between slices.

import { bindPerformWork, cancelTimer, now, postWork, startTimer, type Timer } from "scheduler/src/Host.ts";
import { peek, pop, push } from "./MinHeap.ts";
import {
  IdlePriority,
  ImmediatePriority,
  LowPriority,
  NormalPriority,
  type PriorityLevel,
  UserBlockingPriority,
  timeoutFor,
} from "./Priorities.ts";
import { type Callback, Task } from "./Task.ts";

// How long a slice runs before yielding to the host.
const frameYieldMs = 5;
let frameInterval = frameYieldMs;

const taskQueue: Task[] = [];
const timerQueue: Task[] = [];
let taskIdCounter = 1;

let currentPriorityLevel: PriorityLevel = NormalPriority;

// Set while performing work, to prevent re-entrance.
let isPerformingWork = false;
let isHostCallbackScheduled = false;
let isHostTimeoutScheduled = false;
let needsPaint = false;

let isMessageLoopRunning = false;
let taskTimeout: Timer | null = null;
// When the current slice started.
let sliceStart = -1;

function advanceTimers(currentTime: number): void {
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
      requestHostCallback();
    } else {
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(firstTimer.startTime - currentTime);
      }
    }
  }
}

function flushWork(initialTime: number): boolean {
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }
  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel;
  try {
    return workLoop(initialTime);
  } finally {
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
  }
}

function workLoop(initialTime: number): boolean {
  let currentTime = initialTime;
  advanceTimers(currentTime);
  let task = peek(taskQueue);
  while (task !== null) {
    if (task.expirationTime > currentTime && shouldYieldToHost()) {
      // This task has not expired and the slice is over.
      break;
    }
    // `typeof`, not a null check: JavaScript callers can pass anything, and
    // upstream skips a task whose callback is not a function.
    const callback = task.callback;
    if (typeof callback === "function") {
      task.callback = null;
      currentPriorityLevel = task.priorityLevel;
      const continuation = callback(task.expirationTime <= currentTime);
      currentTime = now();
      if (typeof continuation === "function") {
        // A continuation yields to the host whatever time is left.
        task.callback = continuation;
        advanceTimers(currentTime);
        return true;
      }
      if (task === peek(taskQueue)) {
        pop(taskQueue);
      }
      advanceTimers(currentTime);
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
    requestHostTimeout(firstTimer.startTime - currentTime);
  }
  return false;
}

export function unstable_runWithPriority<T>(priorityLevel: PriorityLevel, eventHandler: () => T): T {
  const level =
    priorityLevel === ImmediatePriority ||
    priorityLevel === UserBlockingPriority ||
    priorityLevel === NormalPriority ||
    priorityLevel === LowPriority ||
    priorityLevel === IdlePriority
      ? priorityLevel
      : NormalPriority;
  const previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = level;
  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

export function unstable_next<T>(eventHandler: () => T): T {
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
  const currentTime = now();
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
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      if (isHostTimeoutScheduled) {
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      requestHostTimeout(startTime - currentTime);
    }
  } else {
    newTask.sortIndex = newTask.expirationTime;
    push(taskQueue, newTask);
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback();
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

function shouldYieldToHost(): boolean {
  if (needsPaint) {
    return true;
  }
  return now() - sliceStart >= frameInterval;
}

export function unstable_shouldYield(): boolean {
  return shouldYieldToHost();
}

export function unstable_requestPaint(): void {
  needsPaint = true;
}

export function unstable_now(): number {
  return now();
}

export function unstable_forceFrameRate(fps: number): void {
  if (fps < 0 || fps > 125) {
    console.error(
      "forceFrameRate takes a positive int between 0 and 125, " +
        "forcing frame rates higher than 125 fps is not supported",
    );
    return;
  }
  frameInterval = fps > 0 ? Math.floor(1000 / fps) : frameYieldMs;
}

function performWorkUntilDeadline(): void {
  needsPaint = false;
  if (!isMessageLoopRunning) {
    return;
  }
  const currentTime = now();
  sliceStart = currentTime;
  // If a task throws, `hasMoreWork` stays true and the next slice resumes
  // the queue after the error has propagated to the host.
  let hasMoreWork = true;
  try {
    hasMoreWork = flushWork(currentTime);
  } finally {
    if (hasMoreWork) {
      schedulePerformWorkUntilDeadline();
    } else {
      isMessageLoopRunning = false;
    }
  }
}

bindPerformWork(performWorkUntilDeadline);

function schedulePerformWorkUntilDeadline(): void {
  postWork();
}

function requestHostCallback(): void {
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;
    schedulePerformWorkUntilDeadline();
  }
}

function requestHostTimeout(ms: number): void {
  taskTimeout = startTimer(() => handleTimeout(now()), ms);
}

function cancelHostTimeout(): void {
  if (taskTimeout !== null) {
    cancelTimer(taskTimeout);
    taskTimeout = null;
  }
}

export const unstable_Profiling = null;

export {
  IdlePriority as unstable_IdlePriority,
  ImmediatePriority as unstable_ImmediatePriority,
  LowPriority as unstable_LowPriority,
  NormalPriority as unstable_NormalPriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
};
