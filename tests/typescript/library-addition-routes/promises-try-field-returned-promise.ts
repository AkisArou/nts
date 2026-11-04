/*---
description: "Promise.try through a class callback field; node adopts the returned promise and preserves its fulfillment value after the synchronous callback."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-closures, ts-arrow-functions]
flags: [async]
---*/
// Promise.try through a class callback field; node adopts the returned promise and preserves its fulfillment value after the synchronous callback.
const log: string[] = [];
class Work {
  invoke: () => Promise<number>;
  constructor(source: Promise<number>) { this.invoke = () => { log.push("call"); return source; }; }
}
async function run(): Promise<void> {
  for (const input of [41, -0]) {
    log.length = 0;
    const source = Promise.resolve(input);
    const work = new Work(source);
    const callback = work.invoke;
    const promise = Promise.try(callback);
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
