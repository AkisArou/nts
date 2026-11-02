/*---
description: A synchronous disposer reached through an await-using parameter rejects after an await boundary and suppresses an earlier body error by identity.
features: [ts-disposal-route-async-disposal, ts-using, ts-async, ts-arrays, ts-errors, ts-unknown, ts-null-undefined, ts-narrowing]
flags: [async]
---*/
// Explicit disposal control; A Disposable parameter may throw synchronously from cleanup; node converts that failure into an awaited rejection, preserving both it and any body error.
function make(fail: boolean, fault: unknown, log: unknown[]): Disposable { return { [Symbol.dispose](): void { log.push("dispose", this); if (fail) throw fault; } }; }
async function consume(resource: Disposable | null | undefined, failBody: boolean, bodyError: unknown, log: unknown[]): Promise<void> {
  try {
    const current = resource, method = current == null ? undefined : current[Symbol.dispose]; let failed = false, pending: unknown = undefined;
    try { assert.sameValue(current, resource); log.push("body"); if (failBody) throw bodyError; log.push("normal"); }
    catch (error) { failed = true; pending = error; }
    finally { try { await (async () => { if (current != null && method !== undefined) method.call(current); })(); }
      catch (error) { pending = failed ? new SuppressedError(error, pending) : error; failed = true; } }
    if (failed) throw pending;
  } catch (error) { log.push("caught"); throw error; }
  log.push("outside");
}
async function main(): Promise<void> {
  const faults: unknown[] = [undefined, new RangeError("dispose"), { fault: true }];
  for (const fault of faults) for (const failBody of [false, true]) for (const failResource of [false, true]) {
    const log: unknown[] = [], resources: (Disposable | null | undefined)[] = [null, undefined, make(failResource, fault, log)], bodyError = { body: true };
    for (const resource of resources) {
      log.length = 0; let failed = false, caught: unknown = undefined; const pending = consume(resource, failBody, bodyError, log); log.push("caller");
      try { await pending; } catch (error) { failed = true; caught = error; } log.push("after");
      const cleanupFails = resource != null && failResource, expected: unknown[] = ["body"];
      if (!failBody) expected.push("normal"); if (resource != null) expected.push("dispose", resource);
      expected.push("caller", cleanupFails || failBody ? "caught" : "outside", "after"); assert.compareArray(log, expected);
      assert.sameValue(failed, cleanupFails || failBody);
      if (cleanupFails && failBody) { assert.sameValue(caught instanceof SuppressedError, true); if (!(caught instanceof SuppressedError)) throw new Error("missing suppression"); assert.sameValue(caught.error, fault); assert.sameValue(caught.suppressed, bodyError); }
      else assert.sameValue(caught, cleanupFails ? fault : failBody ? bodyError : undefined);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
