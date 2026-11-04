/*---
description: "Control: Promise.try through a discriminated callback union; node captures synchronous RangeError throws as rejections while following code still runs."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-unions, ts-narrowing, ts-errors, ts-instanceof]
flags: [async]
---*/
// Promise.try through a discriminated callback union; node captures synchronous RangeError throws as rejections while following code still runs.
const log: string[] = [];
const reason = new RangeError("work");
type Work = { kind: "value"; invoke: () => number } | { kind: "throw"; invoke: () => never };
const jobs: Work[] = [
  { kind: "value", invoke() { log.push("value"); return 31; } },
  { kind: "throw", invoke() { log.push("throw"); throw reason; } }
];
async function run(): Promise<void> {
  for (const work of jobs) {
    log.length = 0;
    const callback = work.invoke;
    const promise = new Promise<number>(resolve => resolve(callback()));
    log.push("sync");
    let result: number | undefined; let rejection: unknown;
    const observed = promise.then(value => { log.push("fulfill"); result = value; }, (error: unknown) => { log.push("reject"); rejection = error; });
    assert.compareArray(log, [work.kind, "sync"]);
    await observed;
    assert.compareArray(log, [work.kind, "sync", work.kind === "value" ? "fulfill" : "reject"]);
    if (work.kind === "value") { assert.sameValue(result, 31); assert.sameValue(rejection, undefined); }
    else { assert.sameValue(result, undefined); assert.sameValue(rejection, reason); assert.sameValue(rejection instanceof RangeError, true); }
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
