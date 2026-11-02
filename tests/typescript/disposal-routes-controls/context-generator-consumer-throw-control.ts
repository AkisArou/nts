/*---
description: A consumer throw keeps its identity while a typed generator closes throwing resources; explicit disposal control.
features: [ts-disposal-route-loops-generators-functions, ts-using, ts-generators, ts-iteration, ts-errors, ts-unknown, ts-tuples]
---*/
// Resources: Disposable tuple suspended in a generator; node preserves a consumer throw over iterator-close failures while still disposing every resource. Explicit cleanup carries the same resources.
type ResourceTriple = [Disposable | null | undefined, Disposable | null | undefined, Disposable | null | undefined];
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
for (const count of [0, 1, 3]) for (const mask of [0, 1, 2, 4, 7]) for (const bodyFails of [false, true]) {
  const log: unknown[] = ["before"]; const bodyError = { tag: "consumer" }; const errors: unknown[] = [undefined, new Error("middle"), { tag: "third" }];
  function make(id: number): Disposable { return { [Symbol.dispose](): void { log.push("dispose", id, this); if ((mask & (1 << id)) !== 0) throw errors[id]; } }; }
  const first = make(0), second = make(1), third = make(2);
  const slots: ResourceTriple = count === 0 ? [null, undefined, null] : count === 1 ? [first, null, undefined] : [first, second, third];
  function* produce(resources: ResourceTriple): Generator<number, void, unknown> {
    const actions: (() => void)[] = []; let pending: unknown; let failed = false;
    try { register(resources[0], actions); register(resources[1], actions); register(resources[2], actions); log.push("yield"); yield 17; log.push("resume"); }
    catch (error: unknown) { pending = error; failed = true; throw error; } finally { finish(actions, pending, failed); }
  }
  const iterator = produce(slots); let caught: unknown; let raised = false;
  try { for (const value of iterator) { log.push("body", value); if (bodyFails) throw bodyError; log.push("body:last"); } log.push("after"); }
  catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
  const expected: unknown[] = ["before", "yield", "body", 17]; const disposalErrors: unknown[] = [];
  if (!bodyFails) expected.push("body:last", "resume");
  for (let id = count - 1; id >= 0; id--) { expected.push("dispose", id, slots[id]); if ((mask & (1 << id)) !== 0) disposalErrors.push(errors[id]); }
  const failures = bodyFails ? [bodyError] : disposalErrors; expected.push(failures.length > 0 ? "catch" : "after");
  checkFailure(caught, failures, raised);
  const finalResult = iterator.next(); assert.sameValue(finalResult.value, undefined); assert.sameValue(finalResult.done, true);
  assert.compareArray(log, expected);
}
