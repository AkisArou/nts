/*---
description: Returning a generator disposes its typed resource tuple only after it has started; explicit disposal control.
features: [ts-disposal-route-loops-generators-functions, ts-using, ts-generators, ts-tuples, ts-arrays, ts-null-undefined]
---*/
// Resources: nullable Disposable tuple parameter inside a generator; node cleans suspended registrations on return but does not acquire before the first next. Explicit cleanup carries the same resources.
type ResourceTriple = [Disposable | null | undefined, Disposable | null | undefined, Disposable | null | undefined];
function register(item: Disposable | null | undefined, actions: (() => void)[]): void {
  if (item !== null && item !== undefined) { const method = item[Symbol.dispose]; actions.push(() => method.call(item)); }
}
function finish(actions: (() => void)[], pending: unknown, raised: boolean): void {
  for (let index = actions.length - 1; index >= 0; index--) {
    try { actions[index](); } catch (error: unknown) { pending = raised ? new SuppressedError(error, pending) : error; raised = true; }
  }
  if (raised) throw pending;
}
function checkResult(actual: IteratorResult<string, string | undefined>, value: string | undefined, done: boolean): void {
  assert.sameValue(actual.value, value); assert.sameValue(actual.done, done); assert.compareArray(Object.keys(actual), ["value", "done"]);
}
for (const count of [0, 1, 3]) for (const phase of [0, 1, 2, 3]) {
  const log: unknown[] = ["before"];
  function make(id: number): Disposable { return { [Symbol.dispose](): void { log.push("dispose", id, this); } }; }
  const first = make(0), second = make(1), third = make(2);
  const slots: ResourceTriple = count === 0 ? [null, undefined, null] : count === 1 ? [first, null, undefined] : [first, second, third];
  function* produce(resources: ResourceTriple): Generator<string, string | undefined, unknown> {
    const actions: (() => void)[] = []; let pending: unknown; let failed = false;
    try { register(resources[0], actions); register(resources[1], actions); register(resources[2], actions);
      log.push("start"); yield "one"; log.push("resume"); yield "two"; log.push("return"); return "natural";
    } catch (error: unknown) { pending = error; failed = true; throw error; } finally { finish(actions, pending, failed); }
  }
  const iterator: Generator<string, string | undefined, unknown> = produce(slots);
  const yielded = ["one", "two", "natural"];
  for (let step = 0; step < phase; step++) checkResult(iterator.next(), yielded[step], step === 2);
  log.push("closing"); checkResult(iterator.return("early"), "early", true); log.push("closed");
  checkResult(iterator.next(), undefined, true); checkResult(iterator.next(), undefined, true);
  const expected: unknown[] = ["before"]; if (phase > 0) expected.push("start"); if (phase > 1) expected.push("resume");
  if (phase > 2) { expected.push("return"); for (let id = count - 1; id >= 0; id--) expected.push("dispose", id, slots[id]); }
  expected.push("closing");
  if (phase > 0 && phase < 3) for (let id = count - 1; id >= 0; id--) expected.push("dispose", id, slots[id]);
  expected.push("closed");
  assert.compareArray(log, expected);
}
