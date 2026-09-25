// The native build's twin of SchedulerMockExtras.ts: a native program runs
// the production scheduler, never the test mock.
export function isMockScheduler(): boolean {
  return false;
}

export function setDisableYieldValue(_newValue: boolean): void {}
