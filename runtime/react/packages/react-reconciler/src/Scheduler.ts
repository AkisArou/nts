// A wrapper around the `scheduler` package, imported by its bare name: under
// upstream's tests Jest mocks `scheduler` to `scheduler/unstable_mock`, and
// only a bare specifier sees that mock.
import * as Scheduler from "scheduler";

export const scheduleCallback = Scheduler.unstable_scheduleCallback;
export const cancelCallback = Scheduler.unstable_cancelCallback;
export const shouldYield = Scheduler.unstable_shouldYield;
export const requestPaint = Scheduler.unstable_requestPaint;
export const now = Scheduler.unstable_now;
export const getCurrentPriorityLevel = Scheduler.unstable_getCurrentPriorityLevel;
export const ImmediatePriority = Scheduler.unstable_ImmediatePriority;
export const UserBlockingPriority = Scheduler.unstable_UserBlockingPriority;
export const NormalPriority = Scheduler.unstable_NormalPriority;
export const LowPriority = Scheduler.unstable_LowPriority;
export const IdlePriority = Scheduler.unstable_IdlePriority;
export type SchedulerCallback = (isSync: boolean) => SchedulerCallback | null | undefined;

// These do not exist on the production scheduler, but they do on
// scheduler/unstable_mock, which the tests use.
interface MockSchedulerExtras {
  log?: (value: unknown) => void;
  unstable_setDisableYieldValue?: (newValue: boolean) => void;
}
const mockExtras: MockSchedulerExtras = Scheduler as MockSchedulerExtras;
export const log: ((value: unknown) => void) | undefined = mockExtras.log;
export const unstable_setDisableYieldValue: ((newValue: boolean) => void) | undefined =
  mockExtras.unstable_setDisableYieldValue;
