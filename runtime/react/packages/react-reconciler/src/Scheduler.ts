// A wrapper around the `scheduler` package, imported by its bare name: under
// upstream's tests Jest mocks `scheduler` to `scheduler/unstable_mock`, and
// only a bare specifier sees that mock. Re-exports, not module-scope copies
// of the functions, so every call goes to whichever module is loaded.
import * as Scheduler from "scheduler";

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

// These do not exist on the production scheduler, but they do on
// scheduler/unstable_mock, which the tests use.
interface MockSchedulerExtras {
  log?: (value: unknown) => void;
  unstable_setDisableYieldValue?: (newValue: boolean) => void;
}

function mockExtras(): MockSchedulerExtras {
  return Scheduler as MockSchedulerExtras;
}

// Whether the loaded scheduler is the test mock, which has `log`.
export function isMockScheduler(): boolean {
  return typeof mockExtras().log === "function";
}

export function setDisableYieldValue(newValue: boolean): void {
  mockExtras().unstable_setDisableYieldValue?.(newValue);
}
