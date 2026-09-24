import type { PriorityLevel } from "./Priorities.ts";

// A scheduled callback. It returns a continuation to be called again at the
// same priority, or nothing when its work is done.
export type Callback = (didTimeout: boolean) => Callback | null | undefined;

export class Task {
  readonly id: number;
  // Null once the task has run to completion or was cancelled. A cancelled
  // task stays in its heap until it reaches the top: a binary heap can only
  // remove its first element.
  callback: Callback | null;
  readonly priorityLevel: PriorityLevel;
  readonly startTime: number;
  readonly expirationTime: number;
  // `startTime` while waiting in the timer queue, `expirationTime` once in
  // the task queue.
  sortIndex: number;

  constructor(
    id: number,
    callback: Callback,
    priorityLevel: PriorityLevel,
    startTime: number,
    expirationTime: number,
  ) {
    this.id = id;
    this.callback = callback;
    this.priorityLevel = priorityLevel;
    this.startTime = startTime;
    this.expirationTime = expirationTime;
    this.sortIndex = -1;
  }
}
