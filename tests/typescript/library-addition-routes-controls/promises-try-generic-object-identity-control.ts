/*---
description: "Control: Promise.try through a constrained generic callback and argument; node preserves the returned object and calls before the generic helper returns."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-interfaces, ts-generics, ts-generic-constraints, ts-arrow-functions]
flags: [async]
---*/
// Promise.try through a constrained generic callback and argument; node preserves the returned object and calls before the generic helper returns.
const log: string[] = [];
interface Payload { id: number; }
function attempt<T extends Payload>(callback: (value: T) => T, input: T): Promise<T> {
  log.push("attempt");
  return new Promise<T>(resolve => resolve(callback(input)));
}
async function run(): Promise<void> {
  for (const input of [{ id: 2 }, { id: 8 }]) {
    log.length = 0;
    const callback = (value: Payload): Payload => { log.push("call:" + value.id); return value; };
    const promise = attempt(callback, input);
    log.push("sync");
    const observed = promise.then(value => { log.push("reaction"); return value; });
    assert.compareArray(log, ["attempt", "call:" + input.id, "sync"]);
    const result = await observed;
    assert.compareArray(log, ["attempt", "call:" + input.id, "sync", "reaction"]);
    assert.sameValue(result, input);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
