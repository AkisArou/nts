/*---
description: A typed optional resource field preserves use identity, reverse disposal, receiver identity and disposed state.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-null-undefined, ts-this]
---*/
// Explicit callback-stack control; A field carries optional Disposable resources into use; node skips nullish resources and disposes the others once in reverse order.
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
interface Resource extends Disposable { id: number; }
interface Holder { resource: Resource | null | undefined; }
const rows: (number | null | undefined)[][] = [[], [0], [null, undefined], [0, null, 1, undefined, 2]];
for (const row of rows) {
  const log: unknown[] = ["before"], stack: Stack = new ManualStack(), holders: Holder[] = [];
  assert.sameValue(stack.disposed, false);
  for (const id of row) { const resource: Resource | null | undefined = id === null || id === undefined ? id : { id, [Symbol.dispose](): void { log.push("dispose", this.id, this, stack.disposed); } }; holders.push({ resource }); }
  for (const holder of holders) { const registered = stack.use(holder.resource);
    assert.sameValue(registered, holder.resource); }
  log.push("inside"); assert.compareArray(log, ["before", "inside"]);
  stack.dispose(); log.push("after"); assert.sameValue(stack.disposed, true);
  const expected: unknown[] = ["before", "inside"];
  for (let i = holders.length - 1; i >= 0; i--) { const resource = holders[i].resource; if (resource !== null && resource !== undefined) expected.push("dispose", resource.id, resource, true); }
  expected.push("after"); assert.compareArray(log, expected);
  const late: Disposable = { [Symbol.dispose](): void { log.push("late"); } };
  assert.throws(ReferenceError, () => stack.use(late)); stack.dispose(); assert.compareArray(log, expected);
}
