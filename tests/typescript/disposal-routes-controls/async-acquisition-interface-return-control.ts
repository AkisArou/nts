/*---
description: Awaited acquisition through an interface method disposes an earlier resource on rejection and both resources on success.
features: [ts-disposal-route-async-disposal, ts-using, ts-async, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-null-undefined]
flags: [async]
---*/
// Explicit disposal control; An interface method returns a promised async resource; node keeps the earlier resource alive across acquisition, then cleans up the acquired values or propagates the original acquisition error.
type Resource = AsyncDisposable | null | undefined;
interface Provider { value: Resource; open(): Promise<Resource>; }
interface Holder { first: AsyncDisposable; provider: Provider; }
function make(log: unknown[]): AsyncDisposable { return { async [Symbol.asyncDispose](): Promise<void> { log.push("start", this); await Promise.resolve(); await Promise.resolve(); log.push("end", this); } }; }
async function consume(holder: Holder, log: unknown[]): Promise<void> {
  const first = holder.first, firstMethod = first[Symbol.asyncDispose];
  try { log.push("first"); const second = await holder.provider.open(), secondMethod = second == null ? undefined : second[Symbol.asyncDispose];
    try { assert.sameValue(first, holder.first); assert.sameValue(second, holder.provider.value); log.push("last"); }
    finally { if (second != null && secondMethod !== undefined) await secondMethod.call(second); else await Promise.resolve(); }
  } finally { await firstMethod.call(first); }
}
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) for (const fail of [false, true]) {
    const log: unknown[] = [], resources: Resource[] = [null, undefined];
    for (let id = 0; id < count; id++) resources.push(make(log));
    for (const resource of resources) {
      log.length = 0; const fault = { acquisition: true };
      const provider: Provider = { value: resource, async open(): Promise<Resource> { log.push("open", this); await Promise.resolve(); log.push("opened", this); if (fail) throw fault; return this.value; } };
      const holder: Holder = { first: make(log), provider }; let failed = false, caught: unknown = undefined;
      const pending = consume(holder, log); log.push("caller"); try { await pending; } catch (error) { failed = true; caught = error; } log.push("after");
      const expected: unknown[] = ["first", "open", provider, "caller", "opened", provider];
      if (!fail) { expected.push("last"); if (resource != null) expected.push("start", resource, "end", resource); }
      expected.push("start", holder.first, "end", holder.first, "after"); assert.compareArray(log, expected);
      assert.sameValue(failed, fail); assert.sameValue(caught, fail ? fault : undefined);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
