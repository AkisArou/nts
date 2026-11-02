/*---
description: A typed iterable parameter disposes each iteration before requesting the next value; explicit disposal control.
features: [ts-disposal-route-loops-generators-functions, ts-using, ts-iteration, ts-interfaces, ts-arrays, ts-null-undefined]
---*/
// Resources: Iterable of nullable Disposable values; node disposes each live value after its last body statement and before the next next call. Explicit cleanup carries the same resources.
interface IterationResource extends Disposable { id: number; }
type MaybeResource = IterationResource | null | undefined;
function register(item: Disposable | null | undefined, actions: (() => void)[]): void {
  if (item !== null && item !== undefined) { const method = item[Symbol.dispose]; actions.push(() => method.call(item)); }
}
function finish(actions: (() => void)[], pending: unknown, raised: boolean): void {
  for (let index = actions.length - 1; index >= 0; index--) {
    try { actions[index](); } catch (error: unknown) { pending = raised ? new SuppressedError(error, pending) : error; raised = true; }
  }
  if (raised) throw pending;
}
for (const shape of [0, 1, 3, 5]) {
  const log: unknown[] = ["before"];
  function make(id: number): IterationResource { return { id, [Symbol.dispose](): void { log.push("dispose", this); } }; }
  const first = make(0), second = make(1), third = make(2);
  const items: MaybeResource[] = shape === 0 ? [] : shape === 1 ? [first] : shape === 3 ? [first, second, third] : [null, first, undefined, second, third];
  const source: Iterable<MaybeResource> = { [Symbol.iterator](): Iterator<MaybeResource> {
    let index = 0; return { next(): IteratorResult<MaybeResource> { log.push("next", index);
      return index < items.length ? { value: items[index++], done: false } : { value: undefined, done: true }; } };
  } };
  function run(values: Iterable<MaybeResource>): void {
    for (const resource of values) {
      const actions: (() => void)[] = []; let pending: unknown; let failed = false;
      try { register(resource, actions); log.push("body", resource, "last"); }
      catch (error: unknown) { pending = error; failed = true; throw error; } finally { finish(actions, pending, failed); }
    }
  }
  run(source); log.push("after");
  const expected: unknown[] = ["before"];
  for (let index = 0; index < items.length; index++) { const item = items[index]; expected.push("next", index, "body", item, "last");
    if (item !== null && item !== undefined) expected.push("dispose", item); }
  expected.push("next", items.length, "after");
  assert.compareArray(log, expected);
}
