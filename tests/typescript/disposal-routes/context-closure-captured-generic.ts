/*---
description: A closure registers its captured generic resources separately on every invocation.
features: [ts-disposal-route-loops-generators-functions, ts-using, ts-functions, ts-generics, ts-arrays, ts-interfaces, ts-errors]
---*/
// Resources: constrained generic array captured by a returned closure; node disposes on each invocation, never at closure creation.
interface CountedResource extends Disposable { closed: number; }
for (const count of [0, 1, 3]) for (const calls of [0, 1, 3]) for (const failAt of [-1, 0, 2]) {
  const log: unknown[] = ["before"]; const problem = { tag: "closure" }; const resources: CountedResource[] = [];
  for (let id = 0; id < count; id++) resources.push({ closed: 0, [Symbol.dispose](): void { this.closed++; log.push("dispose", id, this); } });
  function capture<T extends CountedResource>(values: T[]): () => number {
    log.push("capture"); let turn = 0;
    return () => {
      using first = values[0], second = values[1], third = values[2];
      const index = turn++; log.push("body", index); if (index === failAt) throw problem; return index;
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
