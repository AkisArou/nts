/*---
description: A stored async function can throw after suspended finally cleanup and replace the incoming completion
features: [ts-async-route-rejections, ts-async, ts-errors, ts-unknown, ts-function-types]
flags: [async]
---*/
// A typed async function field crosses native finally; node preserves or replaces completion after the cleanup await.
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
    async function runBody(task: Promise<AsyncValue>): Promise<AsyncValue> {
      state += 1; log.push("body.enter", state);
      try { const result = await task; log.push("body.resume", result); same(result, value); log.push("body.return", result); return result; }
      catch (error: unknown) { log.push("body.caught", error); sameFault(error, fault); log.push("body.rethrow", error); throw error; }
      finally { state += 10; log.push("body.finally.enter", state); await Promise.resolve(); state += 100; log.push("body.finally.resume", state); if (replace) { log.push("body.finally.throw", replacement); throw replacement; } log.push("body.finally.preserve"); }
    }
    const operations: { run: (task: Promise<AsyncValue>) => Promise<AsyncValue> } = { run: runBody }; let rejected: boolean = false;
    try { log.push("call"); const result = await operations.run(source); log.push("settled", result, state); same(result, value); }
    catch (error: unknown) { rejected = true; log.push("caught", error, state); sameFault(error, replace ? replacement : fault, replace); }
    finally { log.push("caller.finally.enter", state); await Promise.resolve(); state += 1000; log.push("caller.finally.resume", state); }
    assert.sameValue(rejected, failed || replace); assert.sameValue(state, 1111);
    const expected: unknown[] = []; const settlement: unknown[] = [failed ? "source.reject" : "source.resolve", failed ? fault : value];
    if (!pending) expected.push(...settlement); expected.push("call", "body.enter", 1); if (pending) expected.push(...settlement);
    if (failed) expected.push("body.caught", fault, "body.rethrow", fault); else expected.push("body.resume", value, "body.return", value);
    expected.push("body.finally.enter", 11, "body.finally.resume", 111); if (replace) expected.push("body.finally.throw", replacement); else expected.push("body.finally.preserve");
    expected.push(failed || replace ? "caught" : "settled", replace ? replacement : failed ? fault : value, 111, "caller.finally.enter", 111, "caller.finally.resume", 1111); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
