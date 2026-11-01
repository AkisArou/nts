/*---
description: Control for promise-all-tuple; concrete async bodies or plain local promises retain the same awaits and observations.
features: [ts-async-route-promises, ts-async, ts-functions, ts-arrays, ts-errors, ts-tuples]
flags: [async]
---*/
interface PromiseObject { id: number; }
type PromiseValue = number | string | undefined | PromiseObject;
const identity: PromiseObject = { id: 7 };
const inputs: PromiseValue[] = [7, -0, "text", undefined, identity];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function makeFirst(value: PromiseValue, pending: boolean, fail: boolean, fault: unknown, log: unknown[], state: { settled: number }): Promise<PromiseValue> {
  log.push("create", "a", value); return new Promise((resolve, reject) => { const finish = (): void => { state.settled++; log.push(fail ? "reject" : "resolve", "a", fail ? fault : value); if (fail) reject(fault); else resolve(value); }; if (pending) queueMicrotask(() => { log.push("defer", "a"); queueMicrotask(finish); }); else finish(); });
}
function makeSecond(value: string, pending: boolean, fail: boolean, fault: unknown, log: unknown[], state: { settled: number }): Promise<string> {
  log.push("create", "b", value); return new Promise((resolve, reject) => { const finish = (): void => { state.settled++; log.push(fail ? "reject" : "resolve", "b", fail ? fault : value); if (fail) reject(fault); else resolve(value); }; if (pending) queueMicrotask(finish); else finish(); });
}
// Plain local promises enter the same combinator and loser drain at the same points.
async function main(): Promise<void> {
  for (const value of inputs) for (const pending of [false, true]) for (const mode of [0, 1, 2]) for (const fault of [new Error("promise fault"), "non-error"]) {
    const log: unknown[] = [], state = { settled: 0 }, tail = "tail:" + typeof value, secondFault: PromiseObject = { id: 99 };
    const first: Promise<PromiseValue> = makeFirst(value, pending, mode > 0, fault, log, state), second: Promise<string> = makeSecond(tail, pending, mode === 2, secondFault, log, state);
    const joined: Promise<[PromiseValue, string]> = Promise.all([first, second]);
    let observed: unknown, caught = false;
    const watched: Promise<[PromiseValue, string]> = joined.then(result => { observed = result; log.push("settled"); log.push(result[0], result[1]); return result; }, (error: unknown) => { observed = error; log.push("rejected", error); throw error; });
    const fails = mode > 0, expectedError = pending && mode === 2 ? secondFault : fault;
    try {
      log.push("await"); const result: [PromiseValue, string] = await watched; same(result, observed);
      assert.sameValue(result.length, 2); same(result[0], value); same(result[1], tail);
      log.push("fulfilled"); log.push(result[0], result[1]);
    } catch (error: unknown) { caught = true; same(error, observed); same(error, expectedError); if (error instanceof Error) assert.sameValue(error.message, "promise fault"); log.push("caught", error); }
    finally { log.push("finally"); }
    assert.sameValue(caught, fails);
    await Promise.allSettled([first, second]); log.push("drained", state.settled); assert.sameValue(state.settled, 2);
    const expected: unknown[] = ["create", "a", value];
    if (!pending) expected.push(mode > 0 ? "reject" : "resolve", "a", mode > 0 ? fault : value);
    expected.push("create", "b", tail); if (!pending) expected.push(mode === 2 ? "reject" : "resolve", "b", mode === 2 ? secondFault : tail);
    expected.push("await"); if (pending) expected.push("defer", "a", mode === 2 ? "reject" : "resolve", "b", mode === 2 ? secondFault : tail, mode > 0 ? "reject" : "resolve", "a", mode > 0 ? fault : value);
    if (fails) expected.push("rejected", expectedError, "caught", expectedError); else expected.push("settled", value, tail, "fulfilled", value, tail);
    expected.push("finally", "drained", 2); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
