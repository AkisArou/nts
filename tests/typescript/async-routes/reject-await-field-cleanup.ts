/*---
description: A Promise typed field preserves fulfillment or rejection before suspended caller cleanup
features: [ts-async-route-rejections, ts-async, ts-errors, ts-unknown, ts-objects]
flags: [async]
---*/
// A Promise<AsyncValue> field crosses await; node catches the original reason before cleanup resumes once.
type AsyncValue = number | string | undefined | { id: number };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function sameFault(actual: unknown, expected: unknown, replacement: boolean = false): void { same(actual, expected); assert.sameValue(actual instanceof Error, expected instanceof Error); if (actual instanceof Error) { assert.sameValue(actual.constructor, replacement ? TypeError : RangeError); assert.sameValue(actual.message, replacement ? "replacement fault" : "source fault"); } }
async function main(): Promise<void> {
  const object = { id: 7 }; const inputs: AsyncValue[] = [3, -0, "text", undefined, object];
  for (const value of inputs) for (const pending of [false, true]) for (const failed of [false, true]) for (const fault of [new RangeError("source fault"), "source fault"]) {
    const log: unknown[] = []; let state: number = 0;
    const source = new Promise<AsyncValue>((resolve, reject) => {
      const settle = (): void => { log.push(failed ? "source.reject" : "source.resolve", failed ? fault : value); if (failed) reject(fault); else resolve(value); };
      if (pending) queueMicrotask(settle); else settle();
    });
    const holder: { task: Promise<AsyncValue> } = { task: source }; let rejected: boolean = false;
    try { log.push("enter"); const result = await holder.task; state += 1; log.push("resumed", result, state); same(result, value); log.push("settled", result); }
    catch (error: unknown) { rejected = true; state += 10; log.push("caught", error, state); sameFault(error, fault); }
    finally { log.push("caller.finally.enter", state); await Promise.resolve(); state += 1000; log.push("caller.finally.resume", state); }
    assert.sameValue(rejected, failed); assert.sameValue(state, (failed ? 10 : 1) + 1000);
    const expected: unknown[] = []; const settlement: unknown[] = [failed ? "source.reject" : "source.resolve", failed ? fault : value];
    if (!pending) expected.push(...settlement); expected.push("enter"); if (pending) expected.push(...settlement);
    if (failed) expected.push("caught", fault, 10); else expected.push("resumed", value, 1, "settled", value);
    expected.push("caller.finally.enter", failed ? 10 : 1, "caller.finally.resume", (failed ? 10 : 1) + 1000); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
