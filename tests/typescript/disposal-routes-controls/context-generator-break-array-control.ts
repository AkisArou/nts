/*---
description: An early consumer break disposes the suspended resource carried by a generator array parameter; explicit disposal control.
features: [ts-disposal-route-loops-generators-functions, ts-using, ts-generators, ts-iteration, ts-arrays, ts-null-undefined]
---*/
// Resources: nullable Disposable array parameter in a yielding loop; node disposes the suspended item on break and never touches later items. Explicit cleanup carries the same resources.
type MaybeResource = Disposable | null | undefined;
function register(item: Disposable | null | undefined, actions: (() => void)[]): void {
  if (item !== null && item !== undefined) { const method = item[Symbol.dispose]; actions.push(() => method.call(item)); }
}
function finish(actions: (() => void)[], pending: unknown, raised: boolean): void {
  for (let index = actions.length - 1; index >= 0; index--) {
    try { actions[index](); } catch (error: unknown) { pending = raised ? new SuppressedError(error, pending) : error; raised = true; }
  }
  if (raised) throw pending;
}
for (const shape of [0, 1, 3, 5]) for (const limit of [1, 2, 9]) {
  const log: unknown[] = ["before"];
  function make(): Disposable { return { [Symbol.dispose](): void { log.push("dispose", this); } }; }
  const first = make(), second = make(), third = make();
  const items: MaybeResource[] = shape === 0 ? [] : shape === 1 ? [first] : shape === 3 ? [first, second, third] : [null, first, undefined, second, third];
  function* produce(values: MaybeResource[]): Generator<MaybeResource, void, unknown> {
    for (const resource of values) {
      const actions: (() => void)[] = []; let pending: unknown; let failed = false;
      try { register(resource, actions); log.push("yield", resource); yield resource; log.push("resume", resource); }
      catch (error: unknown) { pending = error; failed = true; throw error; } finally { finish(actions, pending, failed); }
    }
    log.push("finish");
  }
  const iterator: Generator<MaybeResource, void, unknown> = produce(items); const taken: MaybeResource[] = [];
  for (const resource of iterator) { log.push("consumer", resource); taken.push(resource); if (taken.length === limit) { log.push("break"); break; } }
  log.push("after"); const finalResult = iterator.next();
  const expected: unknown[] = ["before"]; const consumed = Math.min(limit, items.length);
  for (let index = 0; index < consumed; index++) { const resource = items[index]; expected.push("yield", resource, "consumer", resource);
    if (index + 1 === limit) expected.push("break"); else expected.push("resume", resource);
    if (resource !== null && resource !== undefined) expected.push("dispose", resource); }
  if (items.length < limit) expected.push("finish"); expected.push("after");
  assert.compareArray(taken, items.slice(0, consumed));
  assert.sameValue(finalResult.value, undefined); assert.sameValue(finalResult.done, true);
  assert.compareArray(log, expected);
}
