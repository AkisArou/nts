function callInSource(callback: () => void): void { callback(); }
export function queueMicrotaskControl(): number {
  let calls = 0;
  callInSource(() => { calls += 1; });
  return calls;
}
