/*---
description: "Control: Promise.try through a callback-and-arguments tuple; node passes both numeric arguments in order and retains the object argument identity."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-interfaces, ts-tuples, ts-arrow-functions]
flags: [async]
---*/
// Promise.try through a callback-and-arguments tuple; node passes both numeric arguments in order and retains the object argument identity.
const log: string[] = [];
interface Payload { value: number; }
type Work = [(left: number, right: number, object: Payload) => Payload, number, number, Payload];
async function run(): Promise<void> {
  for (const input of [2, 7]) {
    log.length = 0;
    const object: Payload = { value: 0 };
    const work: Work = [(left, right, target) => { log.push("call:" + left + ":" + right); target.value = left * 10 + right; return target; }, input, 3, object];
    const callback = work[0];
    const promise = new Promise<Payload>(resolve => resolve(callback(work[1], work[2], work[3])));
    log.push("sync");
    const observed = promise.then(value => { log.push("reaction"); return value; });
    assert.compareArray(log, ["call:" + input + ":3", "sync"]);
    const result = await observed;
    assert.compareArray(log, ["call:" + input + ":3", "sync", "reaction"]);
    assert.sameValue(result, object);
    assert.sameValue(object.value, input * 10 + 3);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
