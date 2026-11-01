/*---
description: Promise.allSettled reads a typed array of differently timed promises with distinct payloads, Error and non-Error failures, and a complete settlement log.
features: [ts-async-route-promises, ts-async, ts-functions, ts-arrays, ts-errors]
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
// Promise.allSettled reads a typed array; node returns every status and payload in input order.
async function main(): Promise<void> {
  for (const value of inputs) for (const pending of [false, true]) for (const mode of [0, 1, 2]) for (const fault of [new Error("promise fault"), "non-error"]) {
    const log: unknown[] = [], state = { settled: 0 }, tail = "tail:" + typeof value, secondFault: PromiseObject = { id: 99 };
    const members: Promise<PromiseValue>[] = [makeFirst(value, pending, mode > 0, fault, log, state), makeSecond(tail, pending, mode === 2, secondFault, log, state)];
    const joined: Promise<PromiseSettledResult<PromiseValue>[]> = Promise.allSettled(members);
    let observed: unknown, caught = false;
    const watched: Promise<PromiseSettledResult<PromiseValue>[]> = joined.then(result => { observed = result; log.push("settled"); for (const item of result) log.push(item.status, item.status === "fulfilled" ? item.value : item.reason); return result; }, (error: unknown) => { observed = error; log.push("rejected", error); throw error; });
    const fails = false;
    try {
      log.push("await"); const result: PromiseSettledResult<PromiseValue>[] = await watched; same(result, observed);
      assert.sameValue(result.length, 2); for (const index of [0, 1]) { const item = result[index], rejected = index === 0 ? mode > 0 : mode === 2; assert.sameValue(item.status, rejected ? "rejected" : "fulfilled"); same(item.status === "fulfilled" ? item.value : item.reason, rejected ? (index === 0 ? fault : secondFault) : (index === 0 ? value : tail)); }
      log.push("fulfilled"); for (const item of result) log.push(item.status, item.status === "fulfilled" ? item.value : item.reason);
    } catch (error: unknown) { caught = true; same(error, observed); assert.sameValue(false, true, "allSettled unexpectedly rejected"); log.push("caught", error); }
    finally { log.push("finally"); }
    assert.sameValue(caught, fails);
    await Promise.allSettled(members); log.push("drained", state.settled); assert.sameValue(state.settled, 2);
    const expected: unknown[] = ["create", "a", value];
    if (!pending) expected.push(mode > 0 ? "reject" : "resolve", "a", mode > 0 ? fault : value);
    expected.push("create", "b", tail); if (!pending) expected.push(mode === 2 ? "reject" : "resolve", "b", mode === 2 ? secondFault : tail);
    expected.push("await"); if (pending) expected.push("defer", "a", mode === 2 ? "reject" : "resolve", "b", mode === 2 ? secondFault : tail, mode > 0 ? "reject" : "resolve", "a", mode > 0 ? fault : value);
    for (const phase of ["settled", "fulfilled"]) expected.push(phase, mode > 0 ? "rejected" : "fulfilled", mode > 0 ? fault : value, mode === 2 ? "rejected" : "fulfilled", mode === 2 ? secondFault : tail);
    expected.push("finally", "drained", 2); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
