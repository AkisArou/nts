/*---
description: Optional async resources held in fields retain identity and await each disposer before the next one starts.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-null-undefined, ts-this, ts-async]
flags: [async]
---*/
// Explicit callback-stack control; A field carries optional AsyncDisposable resources into use; node awaits start and end pairs in reverse order and skips nullish values.
interface Stack { readonly disposed: boolean; disposeAsync(): Promise<void>;
  use<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T;
}
class ManualStack implements Stack {
  disposed: boolean = false; callbacks: ((() => PromiseLike<void> | void) | undefined)[] = [];
  check(): void { if (this.disposed) throw new ReferenceError("disposed"); }
  use<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T { this.check();
    if (value === null || value === undefined) this.callbacks.push(undefined);
    else if (Symbol.asyncDispose in value) { const method = value[Symbol.asyncDispose]; this.callbacks.push(() => method.call(value)); }
    else { const method = value[Symbol.dispose]; this.callbacks.push(async () => { method.call(value); }); } return value; }
  async disposeAsync(): Promise<void> { if (this.disposed) return; this.disposed = true; let failed = false, failure: unknown, needsAwait = false, hasAwaited = false;
    try { for (let i = this.callbacks.length - 1; i >= 0; i--) { const callback = this.callbacks[i]; if (callback === undefined) { needsAwait = true; continue; }
      try { const result = callback(); try { await result; } finally { hasAwaited = true; } } catch (error) { failure = failed ? new SuppressedError(error, failure) : error; failed = true; } } } finally { this.callbacks = []; }
    if (needsAwait && !hasAwaited) await undefined; if (failed) throw failure; }
}
interface Holder { resource: AsyncDisposable | null | undefined; }
async function main(): Promise<void> {
  const rows: (number | null | undefined)[][] = [[], [0], [null, undefined], [0, null, 1, undefined, 2]];
  for (const row of rows) {
    const log: unknown[] = ["before"], stack: Stack = new ManualStack(), holders: Holder[] = [];
    for (const id of row) holders.push({ resource: id === null || id === undefined ? id : { async [Symbol.asyncDispose](): Promise<void> { log.push("start", id, this, stack.disposed); await Promise.resolve(); log.push("end", id); } } });
    assert.sameValue(stack.disposed, false);
    for (const holder of holders) { const registered = stack.use(holder.resource);
    assert.sameValue(registered, holder.resource); }
    log.push("inside"); assert.compareArray(log, ["before", "inside"]); await stack.disposeAsync(); log.push("after");
    const expected: unknown[] = ["before", "inside"]; for (let i = holders.length - 1; i >= 0; i--) if (row[i] !== null && row[i] !== undefined) expected.push("start", row[i], holders[i].resource, true, "end", row[i]); expected.push("after");
    assert.compareArray(log, expected); assert.sameValue(stack.disposed, true);
    const late: AsyncDisposable = { async [Symbol.asyncDispose](): Promise<void> { log.push("late"); } };
    assert.throws(ReferenceError, () => stack.use(late)); await stack.disposeAsync(); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
