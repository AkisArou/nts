/*---
description: "Promise.try through a private callback field; node runs its argument-taking callback immediately and contains the exact thrown Error in the returned promise."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-errors, ts-instanceof, ts-closures, ts-arrow-functions]
flags: [async]
---*/
// Promise.try through a private callback field; node runs its argument-taking callback immediately and contains the exact thrown Error in the returned promise.
const log: string[] = [];
class Work {
  #invoke: (value: number) => never;
  constructor(reason: Error) { this.#invoke = value => { log.push("call:" + value); throw reason; }; }
  attempt(input: number): Promise<number> {
    log.push("attempt");
    const callback = this.#invoke;
    return Promise.try(callback, input);
  }
}
async function run(): Promise<void> {
  for (const reason of [new TypeError("one"), new RangeError("two")]) {
    log.length = 0;
    const work = new Work(reason);
    const promise = work.attempt(13);
    log.push("sync");
    const observed = promise.then(value => { log.push("unexpected"); return value; }, (error: unknown) => { log.push("reject"); return error; });
    assert.compareArray(log, ["attempt", "call:13", "sync"]);
    const result = await observed;
    assert.compareArray(log, ["attempt", "call:13", "sync", "reject"]);
    assert.sameValue(result, reason);
    assert.sameValue(result instanceof Error, true);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
