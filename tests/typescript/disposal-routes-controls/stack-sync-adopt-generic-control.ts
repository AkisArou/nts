/*---
description: Generic disposable values adopted with explicit callbacks are returned unchanged and cleaned up even when nullish.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-null-undefined, ts-this]
---*/
// Explicit callback-stack control; A constrained generic carries Disposable or nullish values into adopt; node calls each callback with its value and undefined this in reverse order.
interface Stack { readonly disposed: boolean; dispose(): void;
  adopt<T>(value: T, callback: (value: T) => void): T;
}
class ManualStack implements Stack {
  disposed: boolean = false; callbacks: (() => void)[] = [];
  check(): void { if (this.disposed) throw new ReferenceError("disposed"); }
  adopt<T>(value: T, callback: (value: T) => void): T { this.check(); this.callbacks.push(() => callback(value)); return value; }
  dispose(): void { if (this.disposed) return; this.disposed = true; let failed = false, failure: unknown;
    try { for (let i = this.callbacks.length - 1; i >= 0; i--) { const callback = this.callbacks[i]; try { callback(); } catch (error) { failure = failed ? new SuppressedError(error, failure) : error; failed = true; } } } finally { this.callbacks = []; }
    if (failed) throw failure; }
}
function enroll<T extends Disposable | null | undefined>(stack: Stack, value: T, log: unknown[]): T {
  return stack.adopt(value, function (this: void, item: T): void { log.push("adopt", item, this, stack.disposed); });
}
const rows: (number | null | undefined)[][] = [[], [0], [null, undefined], [0, null, 1, undefined, 2]];
for (const row of rows) {
  const log: unknown[] = ["before"], stack: Stack = new ManualStack(), values: (Disposable | null | undefined)[] = [];
  for (const id of row) values.push(id === null || id === undefined ? id : { [Symbol.dispose](): void { log.push("unused", id); } });
  assert.sameValue(stack.disposed, false);
  for (const value of values) assert.sameValue(enroll(stack, value, log), value);
  log.push("inside"); assert.compareArray(log, ["before", "inside"]); stack.dispose(); log.push("after");
  const expected: unknown[] = ["before", "inside"]; for (let i = values.length - 1; i >= 0; i--) expected.push("adopt", values[i], undefined, true); expected.push("after");
  assert.compareArray(log, expected); assert.sameValue(stack.disposed, true);
  assert.throws(ReferenceError, () => enroll(stack, null, log)); stack.dispose(); assert.compareArray(log, expected);
}
