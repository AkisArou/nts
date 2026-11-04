/*---
description: "Control: Promise.try through a readonly callback array; node invokes each selected callback exactly once before its following synchronous marker."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-readonly, ts-tuples, ts-arrow-functions]
flags: [async]
---*/
// Promise.try through a readonly callback array; node invokes each selected callback exactly once before its following synchronous marker.
const log: string[] = [];
const callbacks: readonly ((value: number) => number)[] = [
  value => { log.push("double"); return value * 2; },
  value => { log.push("triple"); return value * 3; }
];
const expected: readonly [string, number][] = [["double", 14], ["triple", 21]];
async function run(): Promise<void> {
  for (let index = 0; index < callbacks.length; index++) {
    log.length = 0;
    const callback = callbacks[index];
    const promise = new Promise<number>(resolve => resolve(callback(7)));
    log.push("sync");
    const observed = promise.then(value => { log.push("reaction"); return value; });
    assert.compareArray(log, [expected[index][0], "sync"]);
    const result = await observed;
    assert.compareArray(log, [expected[index][0], "sync", "reaction"]);
    assert.sameValue(result, expected[index][1]);
    assert.sameValue(callbacks[index], callback);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
