/*---
description: A generic nullable async resource enforces its await boundary before an earlier synchronous disposable is cleaned up.
features: [ts-disposal-route-async-disposal, ts-using, ts-async, ts-generics, ts-arrays, ts-null-undefined]
flags: [async]
---*/
// Explicit disposal control; A constrained generic carries null, undefined or an async resource above a synchronous resource; node crosses the async boundary before disposing the earlier resource.
type Resource = AsyncDisposable | null | undefined;
function makeAsync(log: unknown[]): AsyncDisposable { return { async [Symbol.asyncDispose](): Promise<void> { log.push("start", this); await Promise.resolve(); log.push("end", this); } }; }
function makeSync(log: unknown[]): Disposable { return { [Symbol.dispose](): void { log.push("tail", this); } }; }
async function consume<T extends Resource>(resource: T, tail: Disposable, log: unknown[]): Promise<void> {
  { const previous = tail, previousMethod = previous[Symbol.dispose];
    try { const current = resource, method = current == null ? undefined : current[Symbol.asyncDispose];
      try { assert.sameValue(previous, tail); assert.sameValue(current, resource); log.push("body"); }
      finally { if (current != null && method !== undefined) await method.call(current); else await Promise.resolve(); }
    } finally { previousMethod.call(previous); }
  }
  log.push("outside");
}
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) {
    const log: unknown[] = [], resources: Resource[] = [null, undefined];
    for (let id = 0; id < count; id++) resources.push(makeAsync(log));
    for (const resource of resources) {
      log.length = 0; const tail = makeSync(log), pending = consume(resource, tail, log); log.push("caller"); await pending;
      const expected: unknown[] = ["body"];
      if (resource != null) expected.push("start", resource);
      expected.push("caller"); if (resource != null) expected.push("end", resource);
      expected.push("tail", tail, "outside"); assert.compareArray(log, expected);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
