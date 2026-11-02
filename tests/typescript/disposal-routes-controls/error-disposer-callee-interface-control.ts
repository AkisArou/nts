/*---
description: Interface-dispatched disposers preserve direct and deeper callee errors; explicit disposal control.
features: [ts-disposal-route-errors, ts-using, ts-errors, ts-unknown, ts-interfaces, ts-class, ts-class-fields]
---*/
// Resource: Disposable interface parameter backed by a class; node preserves direct or helper-thrown errors while unwinding the body. Explicit cleanup carries the same resources.
interface ReleasePort extends Disposable { release(): void; }
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
for (const depth of [0, 1]) for (const fails of [false, true]) for (const bodyFails of [false, true]) for (const absent of [false, true]) {
  const log: unknown[] = ["before"]; const problem = { tag: "callee" }; const bodyError = new Error("body");
  function deeper(): void { log.push("deeper"); if (fails) throw problem; log.push("deeper:return"); }
  class Handle implements ReleasePort {
    depth: number;
    constructor(value: number) { this.depth = value; }
    release(): void { log.push("release", this); if (this.depth === 1) deeper(); else if (fails) throw problem; log.push("release:return"); }
    [Symbol.dispose](): void { log.push("dispose", this); this.release(); log.push("dispose:return"); }
  }
  const resource: ReleasePort | undefined = absent ? undefined : new Handle(depth);
  function run(value: ReleasePort | undefined): void {
    const actions: (() => void)[] = []; let pending: unknown; let failed = false;
    try { register(value, actions); log.push("body"); if (bodyFails) throw bodyError; log.push("last"); }
    catch (error: unknown) { pending = error; failed = true; throw error; } finally { finish(actions, pending, failed); }
  }
  let caught: unknown; let raised = false;
  try { run(resource); log.push("after"); } catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
  const failures: unknown[] = bodyFails ? [bodyError] : []; const expected: unknown[] = ["before", "body"];
  if (!bodyFails) expected.push("last");
  if (!absent) { expected.push("dispose", resource, "release", resource); if (depth === 1) expected.push("deeper");
    if (fails) failures.push(problem); else { if (depth === 1) expected.push("deeper:return"); expected.push("release:return", "dispose:return"); } }
  expected.push(failures.length > 0 ? "catch" : "after");
  checkFailure(caught, failures, raised);
  assert.compareArray(log, expected);
}
