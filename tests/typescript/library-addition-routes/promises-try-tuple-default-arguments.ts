/*---
description: "Promise.try through an argument tuple and typed defaulted callback; node runs only the missing defaults, left to right, during the synchronous call."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-tuples, ts-unions, ts-default-parameters]
flags: [async]
---*/
// Promise.try through an argument tuple and typed defaulted callback; node runs only the missing defaults, left to right, during the synchronous call.
const log: string[] = [];
function fallback(label: string, value: number): number { log.push(label); return value; }
function callback(left: number = fallback("left", 2), right: number = fallback("right", 3)): number {
  log.push("call:" + left + ":" + right); return left * 10 + right;
}
type Row = [[number | undefined, number | undefined], number, string[]];
const rows: Row[] = [
  [[undefined, undefined], 23, ["left", "right", "call:2:3"]],
  [[4, undefined], 43, ["right", "call:4:3"]],
  [[undefined, 5], 25, ["left", "call:2:5"]],
  [[4, 5], 45, ["call:4:5"]]
];
async function run(): Promise<void> {
  for (const [args, expected, calls] of rows) {
    log.length = 0;
    const promise = Promise.try(callback, ...args);
    log.push("sync");
    const observed = promise.then(value => { log.push("reaction"); return value; });
    assert.compareArray(log, calls.concat("sync"));
    const result = await observed;
    assert.compareArray(log, calls.concat("sync", "reaction"));
    assert.sameValue(result, expected);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
