/*---
description: A stored finally callback adopts a pending rejection that replaces fulfillment or an earlier rejection
features: [ts-async-route-rejections, ts-async, ts-errors, ts-unknown, ts-function-types]
flags: [async]
---*/
// A () => PromiseLike<AsyncValue> field reaches finally; node adopts cleanup and preserves the exact winning reason.
type AsyncValue = number | string | undefined | { id: number };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function sameFault(actual: unknown, expected: unknown, replacement: boolean = false): void { same(actual, expected); assert.sameValue(actual instanceof Error, expected instanceof Error); if (actual instanceof Error) { assert.sameValue(actual.constructor, replacement ? TypeError : RangeError); assert.sameValue(actual.message, replacement ? "replacement fault" : "source fault"); } }
async function main(): Promise<void> {
  const object = { id: 7 }; const inputs: AsyncValue[] = [3, -0, "text", undefined, object];
  for (const value of inputs) for (const pending of [false, true]) for (const failed of [false, true]) for (const fault of [new RangeError("source fault"), "source fault"]) for (const replace of [false, true]) {
    const log: unknown[] = []; let state: number = 0;
    const replacement: unknown = fault instanceof Error ? new TypeError("replacement fault") : -0;
    const source = new Promise<AsyncValue>((resolve, reject) => {
      const settle = (): void => { log.push(failed ? "source.reject" : "source.resolve", failed ? fault : value); if (failed) reject(fault); else resolve(value); };
      if (pending) queueMicrotask(settle); else settle();
    });
    function cleanupBody(): PromiseLike<AsyncValue> {
      state += 1; log.push("cleanup.enter", arguments.length, state);
      try { log.push("cleanup.adopt"); return new Promise<AsyncValue>((resolve, reject) => queueMicrotask(() => { state += 100; log.push(replace ? "cleanup.reject" : "cleanup.resolve", replace ? replacement : value, state); if (replace) reject(replacement); else resolve(value); })); }
      finally { state += 10; log.push("cleanup.finally", state); }
    }
    const callbacks: { cleanup: () => PromiseLike<AsyncValue> } = { cleanup: cleanupBody }; let rejected: boolean = false;
    try { log.push("attach"); const result = await source.finally(callbacks.cleanup); log.push("settled", result, state); same(result, value); }
    catch (error: unknown) { rejected = true; log.push("caught", error, state); sameFault(error, replace ? replacement : fault, replace); }
    finally { log.push("caller.finally.enter", state); await Promise.resolve(); state += 1000; log.push("caller.finally.resume", state); }
    assert.sameValue(rejected, failed || replace); assert.sameValue(state, 1111);
    const expected: unknown[] = []; const settlement: unknown[] = [failed ? "source.reject" : "source.resolve", failed ? fault : value];
    if (!pending) expected.push(...settlement); expected.push("attach"); if (pending) expected.push(...settlement);
    expected.push("cleanup.enter", 0, 1, "cleanup.adopt", "cleanup.finally", 11, replace ? "cleanup.reject" : "cleanup.resolve", replace ? replacement : value, 111);
    expected.push(failed || replace ? "caught" : "settled", replace ? replacement : failed ? fault : value, 111, "caller.finally.enter", 111, "caller.finally.resume", 1111); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
