/*---
description: "Control: Promise.try through a callback capturing a let binding; node reads the old value synchronously before following code changes the binding."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-closures, ts-arrow-functions]
flags: [async]
---*/
// Promise.try through a callback capturing a let binding; node reads the old value synchronously before following code changes the binding.
const log: string[] = [];
async function run(): Promise<void> {
  for (const input of [47, -0]) {
    log.length = 0;
    let current: number = input;
    const callback = (): number => { log.push("call"); return current; };
    const promise = new Promise<number>(resolve => resolve(callback()));
    current = 99; log.push("write");
    const observed = promise.then(value => { log.push("reaction"); return value; });
    assert.compareArray(log, ["call", "write"]);
    const result = await observed;
    assert.compareArray(log, ["call", "write", "reaction"]);
    assert.sameValue(result, input);
    assert.sameValue(current, 99);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
