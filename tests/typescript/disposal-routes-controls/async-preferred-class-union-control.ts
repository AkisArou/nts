/*---
description: A disposable union prefers a class async-dispose method over its synchronous method and falls back for a synchronous-only class.
features: [ts-disposal-route-async-disposal, ts-using, ts-async, ts-class, ts-class-fields, ts-unions, ts-arrays, ts-null-undefined, ts-narrowing]
flags: [async]
---*/
// Explicit disposal control; Dual and synchronous-only class resources cross a declared disposable union; node selects async cleanup when present, with the original receiver.
class Dual implements AsyncDisposable, Disposable {
  id: number; log: unknown[];
  constructor(id: number, log: unknown[]) { this.id = id; this.log = log; }
  [Symbol.dispose](): void { this.log.push("wrong-sync", this); }
  async [Symbol.asyncDispose](): Promise<void> { this.log.push("async", this); await Promise.resolve(); await Promise.resolve(); this.log.push("finished", this); }
}
class Sync implements Disposable {
  id: number; log: unknown[];
  constructor(id: number, log: unknown[]) { this.id = id; this.log = log; }
  [Symbol.dispose](): void { this.log.push("sync", this); }
}
type Resource = AsyncDisposable | Disposable | null | undefined;
async function consume(resource: Resource, log: unknown[]): Promise<void> {
  { const current = resource; let cleanup: (() => Promise<void>) | undefined;
    if (current != null) {
      if (Symbol.asyncDispose in current) { const method = current[Symbol.asyncDispose]; cleanup = async () => { await method.call(current); }; }
      else { const method = current[Symbol.dispose]; cleanup = async () => { method.call(current); }; }
    }
    try { assert.sameValue(current, resource); log.push("body"); }
    finally { if (cleanup !== undefined) await cleanup(); else await Promise.resolve(); }
  }
  log.push("outside");
}
async function main(): Promise<void> {
  for (const id of [0, 1, 3]) {
    const log: unknown[] = [], resources: Resource[] = [null, undefined, new Dual(id, log), new Sync(id, log)];
    for (const resource of resources) {
      log.length = 0; const pending = consume(resource, log); log.push("caller"); await pending;
      const expected: unknown[] = ["body"];
      if (resource instanceof Dual) expected.push("async", resource, "caller", "finished", resource);
      else { if (resource instanceof Sync) expected.push("sync", resource); expected.push("caller"); }
      expected.push("outside"); assert.compareArray(log, expected);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
