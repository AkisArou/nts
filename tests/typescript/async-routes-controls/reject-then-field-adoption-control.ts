/*---
description: A stored union-returning fulfillment handler chooses plain return, promise adoption or throw (plain-route control)
features: [ts-async-route-rejections, ts-async, ts-errors, ts-unknown, ts-function-types, ts-unions]
flags: [async]
---*/
// A (value: AsyncValue) => AsyncValue | PromiseLike<AsyncValue> field reaches then; node awaits adoption or catches its throw.
type AsyncValue = number | string | undefined | { id: number };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function sameFault(actual: unknown, expected: unknown, replacement: boolean = false): void { same(actual, expected); assert.sameValue(actual instanceof Error, expected instanceof Error); if (actual instanceof Error) { assert.sameValue(actual.constructor, replacement ? TypeError : RangeError); assert.sameValue(actual.message, replacement ? "replacement fault" : "source fault"); } }
async function main(): Promise<void> {
  const object = { id: 7 }; const inputs: AsyncValue[] = [3, -0, "text", undefined, object];
  for (const value of inputs) for (const pending of [false, true]) for (const failed of [false, true]) for (const fault of [new RangeError("source fault"), "source fault"]) for (const mode of ["plain", "adopt", "throw"]) {
    const log: unknown[] = []; let state: number = 0;
    const source = new Promise<AsyncValue>((resolve, reject) => {
      const settle = (): void => { log.push(failed ? "source.reject" : "source.resolve", failed ? fault : value); if (failed) reject(fault); else resolve(value); };
      if (pending) queueMicrotask(settle); else settle();
    });
    function fulfill(input: AsyncValue): AsyncValue | PromiseLike<AsyncValue> {
      state += 1; log.push("handler.enter", input, state); same(input, value);
      try { if (mode === "throw") { log.push("handler.throw", fault); throw fault; }
        if (mode === "adopt") { log.push("handler.adopt", input); return new Promise<AsyncValue>(resolve => queueMicrotask(() => { state += 100; log.push("adopt.resolve", input, state); resolve(input); })); }
        log.push("handler.return", input); return input;
      } finally { state += 10; log.push("handler.finally", state); }
    }
    const callbacks: { fulfilled: (value: AsyncValue) => AsyncValue | PromiseLike<AsyncValue> } = { fulfilled: fulfill }; let rejected: boolean = false;
    try { log.push("attach"); const result = await source.then(fulfill); log.push("settled", result, state); same(result, value); }
    catch (error: unknown) { rejected = true; log.push("caught", error, state); sameFault(error, fault); }
    finally { log.push("caller.finally.enter", state); await Promise.resolve(); state += 1000; log.push("caller.finally.resume", state); }
    const beforeCleanup = failed ? 0 : mode === "adopt" ? 111 : 11; const shouldReject = failed || mode === "throw";
    assert.sameValue(rejected, shouldReject); assert.sameValue(state, beforeCleanup + 1000);
    const expected: unknown[] = []; const settlement: unknown[] = [failed ? "source.reject" : "source.resolve", failed ? fault : value];
    if (!pending) expected.push(...settlement); expected.push("attach"); if (pending) expected.push(...settlement);
    if (!failed) { expected.push("handler.enter", value, 1, mode === "throw" ? "handler.throw" : mode === "adopt" ? "handler.adopt" : "handler.return", mode === "throw" ? fault : value, "handler.finally", 11); if (mode === "adopt") expected.push("adopt.resolve", value, 111); }
    expected.push(shouldReject ? "caught" : "settled", shouldReject ? fault : value, beforeCleanup, "caller.finally.enter", beforeCleanup, "caller.finally.resume", beforeCleanup + 1000); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
