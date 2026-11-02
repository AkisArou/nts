/*---
description: An interface-dispatched class method disposes the current resource field before returning or throwing; explicit disposal control.
features: [ts-disposal-route-loops-generators-functions, ts-using, ts-class, ts-class-fields, ts-interfaces, ts-errors, ts-null-undefined]
---*/
// Resources: mutable field through an interface method on a class; node disposes the value selected for that call before the caller observes completion. Explicit cleanup carries the same resources.
interface WorkPort { current: Disposable | null | undefined; run(fails: boolean): object; }
function register(item: Disposable | null | undefined, actions: (() => void)[]): void {
  if (item !== null && item !== undefined) { const method = item[Symbol.dispose]; actions.push(() => method.call(item)); }
}
function finish(actions: (() => void)[], pending: unknown, raised: boolean): void {
  for (let index = actions.length - 1; index >= 0; index--) {
    try { actions[index](); } catch (error: unknown) { pending = raised ? new SuppressedError(error, pending) : error; raised = true; }
  }
  if (raised) throw pending;
}
for (const shape of [0, 1, 3, 5]) for (const fails of [false, true]) {
  const log: unknown[] = ["before"]; const problem = { tag: "method" }; const payload = { tag: "return" };
  function make(): Disposable { return { [Symbol.dispose](): void { log.push("dispose", this); } }; }
  const first = make(), second = make(), third = make();
  const items: (Disposable | null | undefined)[] = shape === 0 ? [] : shape === 1 ? [first] : shape === 3 ? [first, second, third] : [null, first, undefined, second, third];
  class Worker implements WorkPort {
    current: Disposable | null | undefined = null;
    run(fails: boolean): object {
      const actions: (() => void)[] = []; let pending: unknown; let failed = false;
      try { register(this.current, actions); log.push("body", this); if (fails) throw problem; log.push("return", payload); return payload; }
      catch (error: unknown) { pending = error; failed = true; throw error; } finally { finish(actions, pending, failed); }
    }
  }
  const worker: WorkPort = new Worker();
  for (const resource of items) {
    worker.current = resource; log.push("call", resource); let result: object | undefined; let caught: unknown; let raised = false;
    try { result = worker.run(fails); log.push("returned"); } catch (error: unknown) { caught = error; raised = true; log.push("caught"); }
    assert.sameValue(raised, fails); assert.sameValue(caught, fails ? problem : undefined); assert.sameValue(result, fails ? undefined : payload);
    assert.sameValue(worker.current, resource);
  }
  const expected: unknown[] = ["before"];
  for (const resource of items) { expected.push("call", resource, "body", worker); if (!fails) expected.push("return", payload);
    if (resource !== null && resource !== undefined) expected.push("dispose", resource); expected.push(fails ? "caught" : "returned"); }
  assert.compareArray(log, expected);
}
