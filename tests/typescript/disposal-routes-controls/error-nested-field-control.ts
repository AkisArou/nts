/*---
description: Nested scopes preserve disposal errors carried through typed resource fields; explicit disposal control.
features: [ts-disposal-route-errors, ts-using, ts-errors, ts-unknown, ts-interfaces]
---*/
// Resources: interface fields at two scope depths; node completes inner cleanup before outer cleanup and wraps failures in that order. Explicit cleanup carries the same resources.
interface ScopeResources { outer: Disposable | null; inner: Disposable | undefined; }
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
for (const present of [0, 1, 2]) for (const mask of [0, 1, 2, 3]) for (const bodyFails of [false, true]) {
  const log: unknown[] = ["before"]; const bodyError = { label: "body" }; const errors = [new Error("outer"), new Error("inner")];
  function make(id: number): Disposable { return { [Symbol.dispose](): void { log.push("dispose", id, this); if ((mask & (1 << id)) !== 0) throw errors[id]; } }; }
  const fields: ScopeResources = { outer: present > 0 ? make(0) : null, inner: present > 1 ? make(1) : undefined };
  function run(holder: ScopeResources): void {
    const outside: (() => void)[] = []; let outerError: unknown; let outerFailed = false;
    try {
      register(holder.outer, outside); log.push("outer:body"); const inside: (() => void)[] = []; let innerError: unknown; let innerFailed = false;
      try { register(holder.inner, inside); log.push("inner:body"); if (bodyFails) throw bodyError; log.push("inner:last"); }
      catch (error: unknown) { innerError = error; innerFailed = true; } finally { finish(inside, innerError, innerFailed); }
      log.push("outer:last");
    } catch (error: unknown) { outerError = error; outerFailed = true; } finally { finish(outside, outerError, outerFailed); }
  }
  let caught: unknown; let raised = false;
  try { run(fields); log.push("after"); } catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
  const expected: unknown[] = ["before", "outer:body", "inner:body"]; const failures: unknown[] = bodyFails ? [bodyError] : [];
  if (!bodyFails) expected.push("inner:last");
  if (present > 1) { expected.push("dispose", 1, fields.inner); if ((mask & 2) !== 0) failures.push(errors[1]); }
  if (failures.length === 0) expected.push("outer:last");
  if (present > 0) { expected.push("dispose", 0, fields.outer); if ((mask & 1) !== 0) failures.push(errors[0]); }
  expected.push(failures.length > 0 ? "catch" : "after");
  checkFailure(caught, failures, raised);
  assert.compareArray(log, expected);
}
