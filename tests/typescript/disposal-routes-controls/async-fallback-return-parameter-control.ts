/*---
description: A synchronous disposable parameter ignores its returned thenable during await-using while preserving an asynchronous exit boundary.
features: [ts-disposal-route-async-disposal, ts-using, ts-async, ts-class, ts-class-fields, ts-arrays, ts-null-undefined]
flags: [async]
---*/
// Explicit disposal control; A Disposable parameter returns an object with an observable then getter; node never reads it, but yields before the statement outside the block.
class Handle implements Disposable {
  id: number; log: unknown[];
  constructor(id: number, log: unknown[]) { this.id = id; this.log = log; }
  [Symbol.dispose](): object { const log = this.log; log.push("dispose", this); return { get then(): undefined { log.push("assimilated"); return undefined; } }; }
}
async function consume(resource: Disposable | null | undefined, log: unknown[]): Promise<void> {
  { const current = resource, method = current == null ? undefined : current[Symbol.dispose];
    try { assert.sameValue(current, resource); log.push("body"); }
    finally { if (current != null && method !== undefined) method.call(current); await Promise.resolve(); }
  }
  log.push("outside");
}
async function main(): Promise<void> {
  const log: unknown[] = [], resources: (Disposable | null | undefined)[] = [null, undefined];
  for (const id of [0, 1, 3]) resources.push(new Handle(id, log));
  for (const resource of resources) {
    log.length = 0; const pending = consume(resource, log); log.push("caller"); await pending;
    const expected: unknown[] = ["body"];
    if (resource != null) expected.push("dispose", resource);
    expected.push("caller", "outside"); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
