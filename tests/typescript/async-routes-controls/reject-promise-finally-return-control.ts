/*---
description: A stored finally callback returns plain or adopted values while the original settlement remains visible (plain-route control)
features: [ts-async-route-rejections, ts-async, ts-errors, ts-unknown, ts-function-types, ts-unions]
flags: [async]
---*/
// A typed cleanup field reaches Promise.finally; node waits for adoption and ignores its returned value.
type AsyncValue = number | string | undefined | { id: number };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function sameFault(actual: unknown, expected: unknown, replacement: boolean = false): void { same(actual, expected); assert.sameValue(actual instanceof Error, expected instanceof Error); if (actual instanceof Error) { assert.sameValue(actual.constructor, replacement ? TypeError : RangeError); assert.sameValue(actual.message, replacement ? "replacement fault" : "source fault"); } }
async function main(): Promise<void> {
  const object = { id: 7 }; const inputs: AsyncValue[] = [3, -0, "text", undefined, object];
  for (let index = 0; index < inputs.length; index++) for (const pending of [false, true]) for (const failed of [false, true]) for (const fault of [new RangeError("source fault"), "source fault"]) for (const adopt of [false, true]) {
    const log: unknown[] = []; let state: number = 0;
    const value = inputs[index]; const replacement = inputs[(index + 1) % inputs.length];
    const source = new Promise<AsyncValue>((resolve, reject) => {
      const settle = (): void => { log.push(failed ? "source.reject" : "source.resolve", failed ? fault : value); if (failed) reject(fault); else resolve(value); };
      if (pending) queueMicrotask(settle); else settle();
    });
    function cleanupBody(): AsyncValue | PromiseLike<AsyncValue> {
      state += 1; log.push("cleanup.enter", arguments.length, state);
      try { if (adopt) { log.push("cleanup.adopt", replacement); return new Promise<AsyncValue>(resolve => queueMicrotask(() => { state += 100; log.push("cleanup.resolve", replacement, state); resolve(replacement); })); } log.push("cleanup.return", replacement); return replacement; }
      finally { state += 10; log.push("cleanup.finally", state); }
    }
    const callbacks: { cleanup: () => AsyncValue | PromiseLike<AsyncValue> } = { cleanup: cleanupBody }; let rejected: boolean = false;
    try { log.push("attach"); const result = await source.finally(cleanupBody); log.push("settled", result, state); same(result, value); }
    catch (error: unknown) { rejected = true; log.push("caught", error, state); sameFault(error, fault); }
    finally { log.push("caller.finally.enter", state); await Promise.resolve(); state += 1000; log.push("caller.finally.resume", state); }
    const beforeCleanup = adopt ? 111 : 11; assert.sameValue(rejected, failed); assert.sameValue(state, beforeCleanup + 1000);
    const expected: unknown[] = []; const settlement: unknown[] = [failed ? "source.reject" : "source.resolve", failed ? fault : value];
    if (!pending) expected.push(...settlement); expected.push("attach"); if (pending) expected.push(...settlement);
    expected.push("cleanup.enter", 0, 1, adopt ? "cleanup.adopt" : "cleanup.return", replacement, "cleanup.finally", 11); if (adopt) expected.push("cleanup.resolve", replacement, 111);
    expected.push(failed ? "caught" : "settled", failed ? fault : value, beforeCleanup, "caller.finally.enter", beforeCleanup, "caller.finally.resume", beforeCleanup + 1000); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
