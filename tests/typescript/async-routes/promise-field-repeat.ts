/*---
description: A Promise-valued field retains a settled or pending promise through two later awaits with identical values or rejection reasons.
features: [ts-async-route-promises, ts-async, ts-functions, ts-arrays, ts-errors, ts-interfaces]
flags: [async]
---*/
interface PromiseObject { id: number; }
type PromiseValue = number | string | undefined | PromiseObject;
const identity: PromiseObject = { id: 7 };
const inputs: PromiseValue[] = [7, -0, "text", undefined, identity];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function makePromise(value: PromiseValue, pending: boolean, fail: boolean, fault: unknown, log: unknown[], state: { settled: number }): Promise<PromiseValue> {
  log.push("create", value);
  return new Promise((resolve, reject) => { const finish = (): void => { state.settled++; log.push(fail ? "reject" : "resolve", fail ? fault : value); if (fail) reject(fault); else resolve(value); }; if (pending) queueMicrotask(finish); else finish(); });
}
// A typed field retains a promise; node delivers the same settlement on both later awaits.
interface PromiseHolder { item: Promise<PromiseValue>; }
async function main(): Promise<void> {
  for (const value of inputs) for (const pending of [false, true]) for (const fail of [false, true]) for (const fault of [new Error("promise fault"), "non-error"]) {
    const log: unknown[] = [], state = { settled: 0 };
    const target: Promise<PromiseValue> = makePromise(value, pending, fail, fault, log, state);
    const held: PromiseHolder = { item: target };
    log.push("stored", value); let catches = 0;
    for (const turn of [0, 1]) {
      const selected = held.item;
      try { log.push("await", turn); const result: PromiseValue = await selected; log.push("fulfilled", turn, result); same(result, value); }
      catch (error: unknown) { catches++; same(error, fault); if (error instanceof Error) assert.sameValue(error.message, "promise fault"); log.push("caught", turn, error); }
      finally { log.push("finally", turn); }
    }
    assert.sameValue(catches, fail ? 2 : 0); assert.sameValue(state.settled, 1);
    const expected: unknown[] = ["create", value];
    if (!pending) expected.push(fail ? "reject" : "resolve", fail ? fault : value);
    expected.push("stored", value, "await", 0);
    if (pending) expected.push(fail ? "reject" : "resolve", fail ? fault : value);
    expected.push(fail ? "caught" : "fulfilled", 0, fail ? fault : value, "finally", 0, "await", 1, fail ? "caught" : "fulfilled", 1, fail ? fault : value, "finally", 1);
    assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
