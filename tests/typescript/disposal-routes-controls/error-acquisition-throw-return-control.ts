/*---
description: A dispose-method getter failure on a typed return unwinds only earlier registrations; explicit disposal control.
features: [ts-disposal-route-errors, ts-using, ts-errors, ts-unknown, ts-functions, ts-accessors]
---*/
// Resources: Disposable factory return with a throwing dispose getter; node cleans earlier declarations and never enters the body or registers the failed one. Explicit cleanup carries the same resources.
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
for (const failAt of [-1, 0, 1, 2]) for (const mask of [0, 1, 2, 4, 7]) {
  const log: unknown[] = ["before"]; const acquisition = { tag: "getter" }; const errors: unknown[] = [new Error("first"), undefined, { tag: "third" }];
  const resources: Disposable[] = [];
  function make(id: number): Disposable {
    const item: Disposable = { get [Symbol.dispose](): () => void { log.push("get", id, this); if (id === failAt) throw acquisition;
      return function (this: Disposable): void { log.push("dispose", id, this); if ((mask & (1 << id)) !== 0) throw errors[id]; }; } };
    resources.push(item); return item;
  }
  function run(): void {
    const actions: (() => void)[] = []; let pending: unknown; let failed = false;
    try { register(make(0), actions); register(make(1), actions); register(make(2), actions); log.push("body", "last"); }
    catch (error: unknown) { pending = error; failed = true; throw error; } finally { finish(actions, pending, failed); }
  }
  let caught: unknown; let raised = false;
  try { run(); log.push("after"); } catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
  const expected: unknown[] = ["before"]; const registered = failAt < 0 ? 3 : failAt;
  for (let id = 0; id < (failAt < 0 ? 3 : failAt + 1); id++) expected.push("get", id, resources[id]);
  if (failAt < 0) expected.push("body", "last"); const failures: unknown[] = failAt < 0 ? [] : [acquisition];
  for (let id = registered - 1; id >= 0; id--) { expected.push("dispose", id, resources[id]); if ((mask & (1 << id)) !== 0) failures.push(errors[id]); }
  expected.push(failures.length > 0 ? "catch" : "after");
  assert.sameValue(resources.length, failAt < 0 ? 3 : failAt + 1);
  checkFailure(caught, failures, raised);
  assert.compareArray(log, expected);
}
