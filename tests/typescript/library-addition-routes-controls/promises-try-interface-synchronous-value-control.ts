/*---
description: "Control: Promise.try through an interface callback; node calls it synchronously, preserves its value, and queues fulfillment after following code."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-interfaces]
flags: [async]
---*/
// Promise.try through an interface callback; node calls it synchronously, preserves its value, and queues fulfillment after following code.
const log: string[] = [];
interface Work { invoke(value: number): number; }
const work: Work = { invoke(value) { log.push("call"); return value; } };
async function run(): Promise<void> {
  for (const input of [17, -0, NaN]) {
    log.length = 0;
    const callback = work.invoke;
    const promise = new Promise<number>(resolve => resolve(callback(input)));
    log.push("sync");
    const observed = promise.then(value => { log.push("reaction"); return value; });
    assert.compareArray(log, ["call", "sync"]);
    const result = await observed;
    assert.compareArray(log, ["call", "sync", "reaction"]);
    assert.sameValue(result, input);
    assert.sameValue(work.invoke, callback);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
