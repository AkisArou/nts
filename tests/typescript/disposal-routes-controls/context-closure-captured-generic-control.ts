/*---
description: A closure registers its captured generic resources separately on every invocation; explicit disposal control.
features: [ts-disposal-route-loops-generators-functions, ts-using, ts-functions, ts-generics, ts-arrays, ts-interfaces, ts-errors]
---*/
// Resources: constrained generic array captured by a returned closure; node disposes on each invocation, never at closure creation. Explicit cleanup carries the same resources.
interface CountedResource extends Disposable { closed: number; }
function register(item: Disposable | null | undefined, actions: (() => void)[]): void {
  if (item !== null && item !== undefined) { const method = item[Symbol.dispose]; actions.push(() => method.call(item)); }
}
function finish(actions: (() => void)[], pending: unknown, raised: boolean): void {
  for (let index = actions.length - 1; index >= 0; index--) {
    try { actions[index](); } catch (error: unknown) { pending = raised ? new SuppressedError(error, pending) : error; raised = true; }
  }
  if (raised) throw pending;
}
for (const count of [0, 1, 3]) for (const calls of [0, 1, 3]) for (const failAt of [-1, 0, 2]) {
  const log: unknown[] = ["before"]; const problem = { tag: "closure" }; const resources: CountedResource[] = [];
  for (let id = 0; id < count; id++) resources.push({ closed: 0, [Symbol.dispose](): void { this.closed++; log.push("dispose", id, this); } });
  function capture<T extends CountedResource>(values: T[]): () => number {
    log.push("capture"); let turn = 0;
    return () => {
      const actions: (() => void)[] = []; let pending: unknown; let failed = false;
      try { register(values[0], actions); register(values[1], actions); register(values[2], actions);
        const index = turn++; log.push("body", index); if (index === failAt) throw problem; return index;
      } catch (error: unknown) { pending = error; failed = true; throw error; } finally { finish(actions, pending, failed); }
    };
  }
  const invoke: () => number = capture(resources); log.push("created");
  assert.compareArray(log, ["before", "capture", "created"]);
  for (let index = 0; index < calls; index++) {
    log.push("call", index); let result: number | undefined; let caught: unknown; let raised = false;
    try { result = invoke(); log.push("returned"); } catch (error: unknown) { caught = error; raised = true; log.push("caught"); }
    assert.sameValue(raised, index === failAt); assert.sameValue(caught, index === failAt ? problem : undefined); assert.sameValue(result, index === failAt ? undefined : index);
  }
  const expected: unknown[] = ["before", "capture", "created"];
  for (let index = 0; index < calls; index++) { expected.push("call", index, "body", index);
    for (let id = count - 1; id >= 0; id--) expected.push("dispose", id, resources[id]); expected.push(index === failAt ? "caught" : "returned"); }
  for (const resource of resources) assert.sameValue(resource.closed, calls);
  assert.compareArray(log, expected);
}
