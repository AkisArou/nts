/*---
description: A disposable union selects async methods first and ignores values returned by the synchronous fallback.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-unions, ts-this, ts-async]
flags: [async]
---*/
// Explicit callback-stack control; A union array carries sync, async and dual resources into use; node awaits async methods and never assimilates a sync disposer return value.
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
type Resource = Disposable | AsyncDisposable;
async function main(): Promise<void> {
  const rows: string[][] = [[], ["sync"], ["async"], ["dual"], ["sync", "dual", "async"]];
  for (const row of rows) {
    const log: unknown[] = ["before"], stack: Stack = new ManualStack(), resources: Resource[] = [];
    for (let id = 0; id < row.length; id++) {
      const kind = row[id];
      if (kind === "sync") resources.push({ [Symbol.dispose]() { log.push("sync", id, this, stack.disposed); return { then(): void { log.push("assimilated"); throw new Error("sync return observed"); } }; } });
      else if (kind === "dual") resources.push({ async [Symbol.asyncDispose](): Promise<void> { log.push("start", id, this, stack.disposed); await Promise.resolve(); log.push("end", id); }, [Symbol.dispose](): void { log.push("wrong-sync", id); } });
      else resources.push({ async [Symbol.asyncDispose](): Promise<void> { log.push("start", id, this, stack.disposed); await Promise.resolve(); log.push("end", id); } });
    }
    for (const resource of resources) assert.sameValue(stack.use(resource), resource);
    log.push("inside"); assert.compareArray(log, ["before", "inside"]); await stack.disposeAsync(); log.push("after");
    const expected: unknown[] = ["before", "inside"]; for (let i = resources.length - 1; i >= 0; i--) { if (row[i] === "sync") expected.push("sync", i, resources[i], true); else expected.push("start", i, resources[i], true, "end", i); } expected.push("after");
    assert.compareArray(log, expected); assert.sameValue(stack.disposed, true); await stack.disposeAsync(); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
