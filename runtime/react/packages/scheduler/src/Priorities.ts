export type PriorityLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const NoPriority = 0;
export const ImmediatePriority = 1;
export const UserBlockingPriority = 2;
export const NormalPriority = 3;
export const LowPriority = 4;
export const IdlePriority = 5;

// How long a task at each priority may wait before it expires and runs
// without yielding. Max 31-bit integer for idle: it never times out.
export const userBlockingPriorityTimeout = 250;
export const normalPriorityTimeout = 5000;
export const lowPriorityTimeout = 10000;
export const maxSigned31BitInt = 1073741823;

export function timeoutFor(priorityLevel: PriorityLevel): number {
  switch (priorityLevel) {
    case ImmediatePriority:
      return -1;
    case UserBlockingPriority:
      return userBlockingPriorityTimeout;
    case IdlePriority:
      return maxSigned31BitInt;
    case LowPriority:
      return lowPriorityTimeout;
    default:
      return normalPriorityTimeout;
  }
}
