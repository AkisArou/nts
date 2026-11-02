/*---
description: A generic resource parameter moves ownership into a returned stack while the original becomes permanently disposed.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-null-undefined, ts-this]
---*/
// Explicit callback-stack control; A generic parameter carries optional resources into a returned moved stack; node transfers ownership without disposing until the new owner is closed.
interface Stack { readonly disposed: boolean; dispose(): void;
  use<T extends Disposable | null | undefined>(value: T): T;
  adopt<T>(value: T, callback: (value: T) => void): T;
  defer(callback: () => void): void;
  move(): Stack;
}
class ManualStack implements Stack {
  disposed: boolean = false; callbacks: (() => void)[] = [];
  check(): void { if (this.disposed) throw new ReferenceError("disposed"); }
  use<T extends Disposable | null | undefined>(value: T): T { this.check(); if (value !== null && value !== undefined) { const method = value[Symbol.dispose]; this.callbacks.push(() => method.call(value)); } return value; }
  adopt<T>(value: T, callback: (value: T) => void): T { this.check(); this.callbacks.push(() => callback(value)); return value; }
  defer(callback: () => void): void { this.check(); this.callbacks.push(callback); }
  move(): Stack { this.check(); const owner = new ManualStack(); owner.callbacks = this.callbacks; this.callbacks = []; this.disposed = true; return owner; }
  dispose(): void { if (this.disposed) return; this.disposed = true; let failed = false, failure: unknown;
    try { for (let i = this.callbacks.length - 1; i >= 0; i--) { const callback = this.callbacks[i]; try { callback(); } catch (error) { failure = failed ? new SuppressedError(error, failure) : error; failed = true; } } } finally { this.callbacks = []; }
    if (failed) throw failure; }
}
function transfer<T extends Disposable | null | undefined>(source: Stack, resources: T[]): Stack { for (const resource of resources) source.use(resource); return source.move(); }
for (const count of [0, 1, 3]) {
  const log: unknown[] = ["before"], source: Stack = new ManualStack(), resources: (Disposable | null | undefined)[] = [null, undefined]; let owner: Stack = source;
  for (let id = 0; id < count; id++) resources.push({ [Symbol.dispose](): void { log.push("dispose", id, this, source.disposed, owner.disposed); } });
  owner = transfer(source, resources); log.push("moved");
  assert.sameValue(owner === source, false); assert.sameValue(source.disposed, true); assert.sameValue(owner.disposed, false); assert.compareArray(log, ["before", "moved"]);
  const late: Disposable = { [Symbol.dispose](): void { log.push("late"); } };
  assert.throws(ReferenceError, () => source.use(late)); assert.throws(ReferenceError, () => source.adopt(late, () => log.push("late-adopt")));
  assert.throws(ReferenceError, () => source.defer(() => log.push("late-defer"))); assert.throws(ReferenceError, () => source.move());
  source.dispose(); assert.compareArray(log, ["before", "moved"]); owner.defer(() => log.push("new-owner", owner.disposed));
  owner.dispose(); log.push("after"); const expected: unknown[] = ["before", "moved", "new-owner", true];
  for (let i = count - 1; i >= 0; i--) expected.push("dispose", i, resources[i + 2], true, true); expected.push("after");
  assert.sameValue(owner.disposed, true); assert.compareArray(log, expected); source.dispose(); owner.dispose(); assert.compareArray(log, expected);
}
