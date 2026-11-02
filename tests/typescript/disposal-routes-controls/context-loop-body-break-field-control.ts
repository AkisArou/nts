/*---
description: Breaking a loop cleans the current resource reached through a typed field; explicit disposal control.
features: [ts-disposal-route-loops-generators-functions, ts-using, ts-iteration, ts-class, ts-class-fields, ts-arrays]
---*/
// Resources: class array field read in a loop body; node disposes the current registration before break reaches the following statement. Explicit cleanup carries the same resources.
type MaybeResource = Disposable | null | undefined;
class ResourceBox { items: MaybeResource[]; constructor(items: MaybeResource[]) { this.items = items; } }
function register(item: Disposable | null | undefined, actions: (() => void)[]): void {
  if (item !== null && item !== undefined) { const method = item[Symbol.dispose]; actions.push(() => method.call(item)); }
}
function finish(actions: (() => void)[], pending: unknown, raised: boolean): void {
  for (let index = actions.length - 1; index >= 0; index--) {
    try { actions[index](); } catch (error: unknown) { pending = raised ? new SuppressedError(error, pending) : error; raised = true; }
  }
  if (raised) throw pending;
}
for (const shape of [0, 1, 3, 5]) for (const stop of [0, 1, 3, 9]) {
  const log: unknown[] = ["before"];
  function make(): Disposable { return { [Symbol.dispose](): void { log.push("dispose", this); } }; }
  const first = make(), second = make(), third = make();
  const items: MaybeResource[] = shape === 0 ? [] : shape === 1 ? [first] : shape === 3 ? [first, second, third] : [null, first, undefined, second, third];
  function run(holder: ResourceBox): void {
    let index = 0;
    for (const resource of holder.items) {
      log.push("iteration", index); const actions: (() => void)[] = []; let pending: unknown; let failed = false;
      try { register(resource, actions); log.push("body", resource); if (index++ === stop) { log.push("break"); break; } log.push("last"); }
      catch (error: unknown) { pending = error; failed = true; throw error; } finally { finish(actions, pending, failed); }
    }
  }
  run(new ResourceBox(items)); log.push("after");
  const expected: unknown[] = ["before"];
  for (let index = 0; index < Math.min(items.length, stop + 1); index++) {
    const item = items[index]; expected.push("iteration", index, "body", item, index === stop ? "break" : "last");
    if (item !== null && item !== undefined) expected.push("dispose", item);
  }
  expected.push("after");
  assert.compareArray(log, expected);
}
