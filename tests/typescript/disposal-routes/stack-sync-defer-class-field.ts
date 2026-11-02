/*---
description: Deferred callbacks held in typed class fields dispose their captured resources once and in reverse order.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-class, ts-class-fields, ts-this, ts-function-types]
---*/
// A class field carries a Disposable and its cleanup callback into defer; node calls the callback with undefined this after registration finishes.
interface Stack { readonly disposed: boolean; dispose(): void;
  defer(callback: () => void): void;
}
class Job {
  resource: Disposable; finish: (this: void) => void;
  constructor(resource: Disposable, stack: Stack, log: unknown[]) { this.resource = resource; this.finish = function (this: void): void { log.push("defer", this, stack.disposed); resource[Symbol.dispose](); }; }
}
for (const count of [0, 1, 3]) {
  const log: unknown[] = ["before"], stack: Stack = new DisposableStack(), jobs: Job[] = [];
  for (let id = 0; id < count; id++) { const resource: Disposable = { [Symbol.dispose](): void { log.push("dispose", id, this); } }; jobs.push(new Job(resource, stack, log)); }
  assert.sameValue(stack.disposed, false);
  for (const job of jobs) { const result = stack.defer(job.finish); assert.sameValue(result, undefined); }
  log.push("inside"); assert.compareArray(log, ["before", "inside"]); stack.dispose(); log.push("after");
  const expected: unknown[] = ["before", "inside"]; for (let i = jobs.length - 1; i >= 0; i--) expected.push("defer", undefined, true, "dispose", i, jobs[i].resource); expected.push("after");
  assert.compareArray(log, expected); assert.sameValue(stack.disposed, true);
  assert.throws(ReferenceError, () => stack.defer(() => log.push("late"))); stack.dispose(); assert.compareArray(log, expected);
}
