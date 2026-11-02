/*---
description: An async disposable returned by a constrained generic helper completes cleanup before an async function returns its original result object.
features: [ts-disposal-route-async-disposal, ts-using, ts-async, ts-generics, ts-arrays, ts-null-undefined]
flags: [async]
---*/
// Explicit disposal control; Resources return through a generic identity helper into await-using; node delays the pending object return until asynchronous disposal finishes.
type Resource = AsyncDisposable | null | undefined;
function forward<T extends Resource>(resource: T): T { return resource; }
function make(log: unknown[]): AsyncDisposable { return { async [Symbol.asyncDispose](): Promise<void> { log.push("start", this); await Promise.resolve(); await Promise.resolve(); log.push("end", this); } }; }
async function consume<T extends Resource>(resource: T, result: { id: number }, log: unknown[]): Promise<{ id: number }> {
  const current = forward(resource), method = current == null ? undefined : current[Symbol.asyncDispose];
  try { assert.sameValue(current, resource); log.push("return"); return result; }
  finally { if (current != null && method !== undefined) await method.call(current); else await Promise.resolve(); }
}
async function main(): Promise<void> {
  for (const id of [0, 1, 3]) {
    const log: unknown[] = [], resources: Resource[] = [null, undefined, make(log)];
    for (const resource of resources) {
      log.length = 0; const result = { id }, pending = consume(resource, result, log); log.push("caller");
      const returned = await pending; log.push("after"); assert.sameValue(returned, result);
      const expected: unknown[] = ["return"];
      if (resource != null) expected.push("start", resource);
      expected.push("caller"); if (resource != null) expected.push("end", resource);
      expected.push("after"); assert.compareArray(log, expected);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
