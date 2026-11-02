/*---
description: Generic adopted disposable values retain identity while their asynchronous callbacks complete in reverse order.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-null-undefined, ts-this, ts-async]
flags: [async]
---*/
// Explicit callback-stack control; A constrained generic carries Disposable or nullish values into async adopt; node awaits every callback and passes each exact value with undefined this.
interface Stack { readonly disposed: boolean; disposeAsync(): Promise<void>;
  adopt<T>(value: T, callback: (value: T) => PromiseLike<void> | void): T;
}
class ManualStack implements Stack {
  disposed: boolean = false; callbacks: ((() => PromiseLike<void> | void) | undefined)[] = [];
  check(): void { if (this.disposed) throw new ReferenceError("disposed"); }
  adopt<T>(value: T, callback: (value: T) => PromiseLike<void> | void): T { this.check(); this.callbacks.push(() => callback(value)); return value; }
  async disposeAsync(): Promise<void> { if (this.disposed) return; this.disposed = true; let failed = false, failure: unknown, needsAwait = false, hasAwaited = false;
    try { for (let i = this.callbacks.length - 1; i >= 0; i--) { const callback = this.callbacks[i]; if (callback === undefined) { needsAwait = true; continue; }
      try { const result = callback(); try { await result; } finally { hasAwaited = true; } } catch (error) { failure = failed ? new SuppressedError(error, failure) : error; failed = true; } } } finally { this.callbacks = []; }
    if (needsAwait && !hasAwaited) await undefined; if (failed) throw failure; }
}
function enroll<T extends Disposable | null | undefined>(stack: Stack, value: T, log: unknown[]): T {
  return stack.adopt(value, async function (this: void, item: T): Promise<void> { log.push("start", item, this, stack.disposed); await Promise.resolve(); log.push("end", item); });
}
async function main(): Promise<void> {
  const rows: (number | null | undefined)[][] = [[], [0], [null, undefined], [0, null, 1, undefined, 2]];
  for (const row of rows) {
    const log: unknown[] = ["before"], stack: Stack = new ManualStack(), values: (Disposable | null | undefined)[] = [];
    for (const id of row) values.push(id === null || id === undefined ? id : { [Symbol.dispose](): void { log.push("unused", id); } });
    assert.sameValue(stack.disposed, false); for (const value of values) assert.sameValue(enroll(stack, value, log), value);
    log.push("inside"); assert.compareArray(log, ["before", "inside"]); await stack.disposeAsync(); log.push("after");
    const expected: unknown[] = ["before", "inside"]; for (let i = values.length - 1; i >= 0; i--) expected.push("start", values[i], undefined, true, "end", values[i]); expected.push("after");
    assert.compareArray(log, expected); assert.sameValue(stack.disposed, true);
    assert.throws(ReferenceError, () => enroll(stack, null, log)); await stack.disposeAsync(); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
