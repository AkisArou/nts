/*---
description: Interface-held asynchronous disposers keep rejection identity and every link of the suppression chain.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-this, ts-async]
flags: [async]
---*/
// Explicit callback-stack control; An interface field carries AsyncDisposable arrays with rejection positions; node awaits every cleanup and retains all errors in the complete SuppressedError chain.
interface Stack { readonly disposed: boolean; disposeAsync(): Promise<void>;
  use<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T;
  adopt<T>(value: T, callback: (value: T) => PromiseLike<void> | void): T;
  defer(callback: () => PromiseLike<void> | void): void;
}
class ManualStack implements Stack {
  disposed: boolean = false; callbacks: ((() => PromiseLike<void> | void) | undefined)[] = [];
  check(): void { if (this.disposed) throw new ReferenceError("disposed"); }
  use<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T { this.check();
    if (value === null || value === undefined) this.callbacks.push(undefined);
    else if (Symbol.asyncDispose in value) { const method = value[Symbol.asyncDispose]; this.callbacks.push(() => method.call(value)); }
    else { const method = value[Symbol.dispose]; this.callbacks.push(async () => { method.call(value); }); } return value; }
  adopt<T>(value: T, callback: (value: T) => PromiseLike<void> | void): T { this.check(); this.callbacks.push(() => callback(value)); return value; }
  defer(callback: () => PromiseLike<void> | void): void { this.check(); this.callbacks.push(callback); }
  async disposeAsync(): Promise<void> { if (this.disposed) return; this.disposed = true; let failed = false, failure: unknown, needsAwait = false, hasAwaited = false;
    try { for (let i = this.callbacks.length - 1; i >= 0; i--) { const callback = this.callbacks[i]; if (callback === undefined) { needsAwait = true; continue; }
      try { const result = callback(); try { await result; } finally { hasAwaited = true; } } catch (error) { failure = failed ? new SuppressedError(error, failure) : error; failed = true; } } } finally { this.callbacks = []; }
    if (needsAwait && !hasAwaited) await undefined; if (failed) throw failure; }
}
interface Supply { resources: AsyncDisposable[]; }
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) for (let mask = 0; mask < (1 << count); mask++) {
    const log: unknown[] = ["before"], stack: Stack = new ManualStack(), supply: Supply = { resources: [] }, errors: unknown[] = [new Error("first"), undefined, { failure: "last" }];
    for (let id = 0; id < count; id++) supply.resources.push({ async [Symbol.asyncDispose](): Promise<void> { log.push("start", id, this, stack.disposed); await Promise.resolve(); log.push("end", id); if ((mask & (1 << id)) !== 0) throw errors[id]; } });
    for (let i = 0; i < supply.resources.length; i++) { const resource = supply.resources[i]; if (i % 3 === 0) assert.sameValue(stack.use(resource), resource); else if (i % 3 === 1) assert.sameValue(stack.adopt(resource, value => value[Symbol.asyncDispose]()), resource); else stack.defer(() => resource[Symbol.asyncDispose]()); }
    log.push("inside"); assert.compareArray(log, ["before", "inside"]); let caught: unknown, failed = false;
    try { await stack.disposeAsync(); } catch (error) { caught = error; failed = true; } log.push("after");
    const expected: unknown[] = ["before", "inside"]; for (let i = count - 1; i >= 0; i--) expected.push("start", i, supply.resources[i], true, "end", i); expected.push("after");
    const failures: unknown[] = []; for (let i = 0; i < count; i++) if ((mask & (1 << i)) !== 0) failures.push(errors[i]);
    assert.sameValue(failed, failures.length > 0); let cursor: unknown = caught;
    for (let i = 0; i + 1 < failures.length; i++) { assert.sameValue(cursor instanceof SuppressedError, true); if (!(cursor instanceof SuppressedError)) throw new Error("missing suppression"); assert.sameValue(cursor.name, "SuppressedError"); assert.sameValue(cursor.error, failures[i]); cursor = cursor.suppressed; }
    assert.sameValue(cursor, failures.length === 0 ? undefined : failures[failures.length - 1]); assert.compareArray(log, expected); assert.sameValue(stack.disposed, true);
    await stack.disposeAsync(); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
