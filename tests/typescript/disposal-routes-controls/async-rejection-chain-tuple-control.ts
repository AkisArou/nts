/*---
description: Async disposers in a tuple field preserve every rejection and body error in the complete correctly ordered SuppressedError chain.
features: [ts-disposal-route-async-disposal, ts-using, ts-async, ts-interfaces, ts-tuples, ts-arrays, ts-errors, ts-unknown, ts-null-undefined, ts-narrowing]
flags: [async]
---*/
// Explicit disposal control; A nullable async-resource tuple disposes right to left; node keeps each original rejection, including undefined, as the newest error above the earlier completion.
type Resource = AsyncDisposable | null | undefined;
interface Batch { resources: [Resource, Resource, Resource]; failBody: boolean; }
function make(id: number, fail: boolean, fault: unknown, log: unknown[]): AsyncDisposable { return { async [Symbol.asyncDispose](): Promise<void> { log.push(id, "start", this); await Promise.resolve(); log.push(id, "end", this); if (fail) throw fault; } }; }
async function consume(batch: Batch, bodyError: unknown, log: unknown[]): Promise<void> {
  const first = batch.resources[0], second = batch.resources[1], third = batch.resources[2], callbacks: (() => PromiseLike<void>)[] = [];
  for (const resource of [first, second, third]) if (resource != null) { const method = resource[Symbol.asyncDispose]; callbacks.push(() => method.call(resource)); }
  let failed = false, pending: unknown = undefined;
  try {
    assert.sameValue(first, batch.resources[0]); assert.sameValue(second, batch.resources[1]); assert.sameValue(third, batch.resources[2]);
    log.push("body"); if (batch.failBody) throw bodyError; log.push("normal");
  } catch (error) { failed = true; pending = error; }
  finally {
    for (let id = callbacks.length - 1; id >= 0; id--) { try { await callbacks[id](); } catch (error) { pending = failed ? new SuppressedError(error, pending) : error; failed = true; } }
    if (callbacks.length === 0) await Promise.resolve();
  }
  if (failed) throw pending;
}
async function main(): Promise<void> {
  const samples: [number, boolean, boolean, boolean, boolean][] = [[0, false, false, false, false], [0, true, false, false, false], [1, false, false, false, false], [1, false, true, false, false], [1, true, true, false, false], [3, false, true, false, false], [3, true, false, true, false], [3, false, false, false, true], [3, true, true, false, true], [3, true, true, true, true]];
  for (const sample of samples) {
    const log: unknown[] = [], resources: AsyncDisposable[] = [], faults: unknown[] = [undefined, new RangeError("middle"), { last: true }], bodyError = { body: true }, fails: boolean[] = [sample[2], sample[3], sample[4]];
    for (let id = 0; id < sample[0]; id++) resources.push(make(id, fails[id], faults[id], log));
    const batch: Batch = { resources: [resources[0], resources[1] ?? null, resources[2]], failBody: sample[1] };
    let failed = false, caught: unknown = undefined;
    try { await consume(batch, bodyError, log); } catch (error) { failed = true; caught = error; } log.push("after");
    const expected: unknown[] = ["body"], errors: unknown[] = [];
    if (!sample[1]) expected.push("normal");
    for (let id = sample[0] - 1; id >= 0; id--) expected.push(id, "start", resources[id], id, "end", resources[id]);
    expected.push("after"); assert.compareArray(log, expected);
    for (let id = 0; id < sample[0]; id++) if (fails[id]) errors.push(faults[id]);
    if (sample[1]) errors.push(bodyError); assert.sameValue(failed, errors.length > 0);
    for (let id = 0; id + 1 < errors.length; id++) { assert.sameValue(caught instanceof SuppressedError, true); if (!(caught instanceof SuppressedError)) throw new Error("missing suppression"); assert.sameValue(caught.error, errors[id]); caught = caught.suppressed; }
    assert.sameValue(caught, errors.length === 0 ? undefined : errors[errors.length - 1]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
