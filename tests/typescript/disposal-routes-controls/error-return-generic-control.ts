/*---
description: A constrained generic resource array replaces a pending return only with actual disposal failures; explicit disposal control.
features: [ts-disposal-route-errors, ts-using, ts-errors, ts-unknown, ts-generics, ts-arrays]
---*/
// Resources: generic Disposable array parameter; node returns the payload when clean and never suppresses a return value as an error. Explicit cleanup carries the same resources.
function checkFailure(error: unknown, expected: unknown[], raised: boolean): void {
  assert.sameValue(raised, expected.length > 0);
  if (expected.length === 0) { assert.sameValue(error, undefined); return; }
  for (let index = expected.length - 1; index > 0; index--) {
    assert.sameValue(error instanceof SuppressedError, true);
    if (!(error instanceof SuppressedError)) throw new Error("missing suppression");
    assert.sameValue(error.error, expected[index]); error = error.suppressed;
  }
  assert.sameValue(error, expected[0]);
}
function register(item: Disposable | null | undefined, actions: (() => void)[]): void {
  if (item !== null && item !== undefined) { const method = item[Symbol.dispose]; actions.push(() => method.call(item)); }
}
function finish(actions: (() => void)[], pending: unknown, raised: boolean): void {
  for (let index = actions.length - 1; index >= 0; index--) {
    try { actions[index](); } catch (error: unknown) { pending = raised ? new SuppressedError(error, pending) : error; raised = true; }
  }
  if (raised) throw pending;
}
for (const count of [0, 1, 3]) for (const mask of [0, 1, 2, 4, 7]) {
  const log: unknown[] = ["before"]; const payload = { tag: "return" }; const errors: unknown[] = [undefined, new Error("middle"), { tag: "last" }];
  const items: Disposable[] = [];
  for (let id = 0; id < count; id++) items.push({ [Symbol.dispose](): void { log.push("dispose", id, this); if ((mask & (1 << id)) !== 0) throw errors[id]; } });
  function run<T extends Disposable>(resources: T[]): object {
    const actions: (() => void)[] = []; let pending: unknown; let failed = false;
    try { register(resources[0], actions); register(resources[1], actions); register(resources[2], actions); log.push("return", payload); return payload; }
    catch (error: unknown) { pending = error; failed = true; throw error; } finally { finish(actions, pending, failed); }
  }
  let result: object | undefined; let caught: unknown; let raised = false;
  try { result = run(items); log.push("after"); } catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
  const expected: unknown[] = ["before", "return", payload]; const failures: unknown[] = [];
  for (let index = count - 1; index >= 0; index--) { expected.push("dispose", index, items[index]); if ((mask & (1 << index)) !== 0) failures.push(errors[index]); }
  expected.push(failures.length > 0 ? "catch" : "after");
  assert.sameValue(result, failures.length === 0 ? payload : undefined);
  checkFailure(caught, failures, raised);
  assert.compareArray(log, expected);
}
