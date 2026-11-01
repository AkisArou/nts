/*---
description: A Map stored chain is handled after a microtask while settled and pending sources retain their order (plain-route control)
features: [ts-async-route-rejections, ts-async, ts-errors, ts-unknown, ts-map-set]
flags: [async]
---*/
// A Map<string, Promise<AsyncValue>> carries a chain across one await; node handles a prior rejection within the same microtask turn.
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
    const chain = source.then(input => { state += 1; log.push("chain.fulfilled", input, state); same(input, value); return input; }, (error: unknown) => { state += 1; log.push("chain.rejected", error, state); sameFault(error, fault); throw error; });
    const registry: Map<string, Promise<AsyncValue>> = new Map([["chain", chain]]); log.push("stored", "delay.enter");
    await Promise.resolve(); log.push("delay.resume");
    const selected = chain; if (selected === undefined) throw new Error("missing chain");
    function recover(error: unknown): Promise<AsyncValue> { state += 10; log.push("recover.enter", error, state); sameFault(error, fault); log.push("recover.adopt", value); return Promise.resolve(value); }
    try { log.push("attach"); const result = await selected.catch(recover); log.push("settled", result, state); same(result, value); }
    finally { log.push("caller.finally.enter", state); await Promise.resolve(); state += 1000; log.push("caller.finally.resume", state); }
    const beforeCleanup = failed ? 11 : 1; assert.sameValue(state, beforeCleanup + 1000);
    const expected: unknown[] = []; const settlement: unknown[] = [failed ? "source.reject" : "source.resolve", failed ? fault : value]; const forwarded: unknown[] = [failed ? "chain.rejected" : "chain.fulfilled", failed ? fault : value, 1];
    if (!pending) expected.push(...settlement); expected.push("stored", "delay.enter"); if (pending) expected.push(...settlement); else expected.push(...forwarded);
    expected.push("delay.resume", "attach"); if (pending) expected.push(...forwarded); if (failed) expected.push("recover.enter", fault, 11, "recover.adopt", value);
    expected.push("settled", value, beforeCleanup, "caller.finally.enter", beforeCleanup, "caller.finally.resume", beforeCleanup + 1000); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
