/*---
description: A typed resource parameter captures its dispose method once at registration and retains the original receiver.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-class, ts-class-fields, ts-this]
---*/
// Explicit callback-stack control; A Disposable parameter carries a class with a dispose getter; node reads it once at use and calls the captured function despite later replacement.
interface Stack { readonly disposed: boolean; dispose(): void;
  use<T extends Disposable | null | undefined>(value: T): T;
}
class ManualStack implements Stack {
  disposed: boolean = false; callbacks: (() => void)[] = [];
  check(): void { if (this.disposed) throw new ReferenceError("disposed"); }
  use<T extends Disposable | null | undefined>(value: T): T { this.check(); if (value !== null && value !== undefined) { const method = value[Symbol.dispose]; this.callbacks.push(() => method.call(value)); } return value; }
  dispose(): void { if (this.disposed) return; this.disposed = true; let failed = false, failure: unknown;
    try { for (let i = this.callbacks.length - 1; i >= 0; i--) { const callback = this.callbacks[i]; try { callback(); } catch (error) { failure = failed ? new SuppressedError(error, failure) : error; failed = true; } } } finally { this.callbacks = []; }
    if (failed) throw failure; }
}
class Resource implements Disposable {
  id: number; log: unknown[]; current: (this: Resource) => void;
  constructor(id: number, log: unknown[]) { this.id = id; this.log = log; this.current = function (this: Resource): void { this.log.push("original", this.id, this); }; }
  get [Symbol.dispose](): (this: Resource) => void { this.log.push("get", this.id, this); return this.current; }
}
function enroll(resource: Disposable, stack: Stack): void { stack.use(resource); }
for (const count of [0, 1, 3]) {
  const log: unknown[] = ["before"], stack: Stack = new ManualStack(), resources: Resource[] = [];
  for (let id = 0; id < count; id++) resources.push(new Resource(id, log));
  for (const resource of resources) enroll(resource, stack);
  const expected: unknown[] = ["before"]; for (const resource of resources) expected.push("get", resource.id, resource);
  assert.compareArray(log, expected);
  for (const resource of resources) resource.current = function (this: Resource): void { this.log.push("replacement", this.id, this); };
  log.push("inside"); expected.push("inside"); assert.compareArray(log, expected); stack.dispose(); log.push("after");
  for (let i = resources.length - 1; i >= 0; i--) expected.push("original", i, resources[i]); expected.push("after");
  assert.compareArray(log, expected); assert.sameValue(stack.disposed, true);
  const late = new Resource(99, log); assert.throws(ReferenceError, () => enroll(late, stack)); stack.dispose(); assert.compareArray(log, expected);
}
