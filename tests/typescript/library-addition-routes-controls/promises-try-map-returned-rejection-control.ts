/*---
description: "Control: Promise.try through a Map callback value; node adopts its returned rejection while the callback remains synchronous and its error identity survives."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-map-set, ts-narrowing, ts-errors, ts-instanceof, ts-closures, ts-arrow-functions]
flags: [async]
---*/
// Promise.try through a Map callback value; node adopts its returned rejection while the callback remains synchronous and its error identity survives.
const log: string[] = [];
async function run(): Promise<void> {
  for (const reason of [new TypeError("one"), new RangeError("two")]) {
    log.length = 0;
    const callbacks: Map<string, () => Promise<number>> = new Map([["work", () => { log.push("call"); return Promise.reject(reason); }]]);
    const callback = callbacks.get("work");
    if (callback === undefined) throw new Error("missing callback");
    const promise = new Promise<number>(resolve => resolve(callback()));
    log.push("sync");
    const observed = promise.then(value => { log.push("unexpected"); return value; }, (error: unknown) => { log.push("reject"); return error; });
    assert.compareArray(log, ["call", "sync"]);
    const result = await observed;
    assert.compareArray(log, ["call", "sync", "reject"]);
    assert.sameValue(result, reason);
    assert.sameValue(result instanceof Error, true);
    assert.sameValue(callbacks.get("work"), callback);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
