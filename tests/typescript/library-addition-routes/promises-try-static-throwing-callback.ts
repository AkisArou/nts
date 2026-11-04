/*---
description: "Promise.try through a static callback field; node captures both error classes without escaping and invokes each installed callback only once."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-static, ts-errors, ts-instanceof, ts-closures, ts-arrow-functions]
flags: [async]
---*/
// Promise.try through a static callback field; node captures both error classes without escaping and invokes each installed callback only once.
const log: string[] = [];
class Work { static invoke: () => number = () => { log.push("unused"); return 0; }; }
async function run(): Promise<void> {
  for (const reason of [new RangeError("one"), new TypeError("two")]) {
    log.length = 0;
    Work.invoke = () => { log.push("call"); throw reason; };
    const callback = Work.invoke;
    const promise = Promise.try(callback);
    log.push("sync");
    const observed = promise.then(value => { log.push("unexpected"); return value; }, (error: unknown) => { log.push("reject"); return error; });
    assert.compareArray(log, ["call", "sync"]);
    const result = await observed;
    assert.compareArray(log, ["call", "sync", "reject"]);
    assert.sameValue(result, reason);
    assert.sameValue(result instanceof Error, true);
    assert.sameValue(Work.invoke, callback);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
