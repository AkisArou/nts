// A wrapper around the `scheduler` package, imported by its bare name: under
// upstream's tests Jest mocks `scheduler` to `scheduler/unstable_mock`, and
// only a bare specifier sees that mock. Re-exports, not module-scope copies
// of the functions, so every call goes to whichever module is loaded. What
// only the mock has is in SchedulerMockExtras.ts.

export {
  unstable_cancelCallback as cancelCallback,
  unstable_getCurrentPriorityLevel as getCurrentPriorityLevel,
  unstable_IdlePriority as IdlePriority,
  unstable_ImmediatePriority as ImmediatePriority,
  unstable_LowPriority as LowPriority,
  unstable_NormalPriority as NormalPriority,
  unstable_now as now,
  unstable_requestPaint as requestPaint,
  unstable_scheduleCallback as scheduleCallback,
  unstable_shouldYield as shouldYield,
  unstable_UserBlockingPriority as UserBlockingPriority,
} from "scheduler";

export type SchedulerCallback = (isSync: boolean) => SchedulerCallback | null | undefined;
