// What only scheduler/unstable_mock has. Upstream's tests load the mock in
// place of `scheduler`, and the reconciler asks for these two to quiet strict
// mode's double render. A fork point: the native build never has the mock.
//
// The namespace is read at each call, not copied at load, so every call sees
// whichever `scheduler` module is loaded.
import * as Scheduler from "scheduler";

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
