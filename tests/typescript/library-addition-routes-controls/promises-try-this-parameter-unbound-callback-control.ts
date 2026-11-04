/*---
description: "Control: Promise.try through an interface callback with a this parameter; node calls with undefined this and preserves the ordered arguments."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-interfaces, ts-this-parameter]
flags: [async]
---*/
// Promise.try through an interface callback with a this parameter; node calls with undefined this and preserves the ordered arguments.
const log: string[] = [];
interface Work { invoke(this: undefined, left: number, right: number): number; }
const work: Work = {
  invoke(this: undefined, left: number, right: number): number {
    log.push("call:" + left + ":" + right);
    assert.sameValue(this, undefined);
    return left * 10 + right;
  }
};
async function run(): Promise<void> {
  for (const input of [2, 5]) {
    log.length = 0;
    const callback = work.invoke;
    const promise = new Promise<number>(resolve => resolve(callback.call(undefined, input, 3)));
    log.push("sync");
    const observed = promise.then(value => { log.push("reaction"); return value; });
    assert.compareArray(log, ["call:" + input + ":3", "sync"]);
    const result = await observed;
    assert.compareArray(log, ["call:" + input + ":3", "sync", "reaction"]);
    assert.sameValue(result, input * 10 + 3);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
