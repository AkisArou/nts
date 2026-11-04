/*---
description: "Control: Promise.withResolvers through an interface constructor field; node keeps the first resolve, ignores later settlements, and queues the reaction."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-interfaces, ts-unions]
flags: [async]
---*/
// Promise.withResolvers through an interface constructor field; node keeps the first resolve, ignores later settlements, and queues the reaction.
const log: string[] = [];
interface FactoryBox { factory: PromiseConstructor; }
const box: FactoryBox = { factory: Promise };
async function run(): Promise<void> {
  let previous: Promise<number> | undefined;
  for (const input of [7, -0, NaN]) {
    log.length = 0;
    const factory: PromiseConstructor = box.factory;
    let capResolve: (value: number | PromiseLike<number>) => void = () => {};
    let capReject: (reason?: unknown) => void = () => {};
    const capPromise = new factory<number>((resolve, reject) => { capResolve = resolve; capReject = reject; });
    const cap: PromiseWithResolvers<number> = { promise: capPromise, resolve: capResolve, reject: capReject };
    const observed = cap.promise.then(value => { log.push("reaction"); return value; });
    log.push("before"); cap.resolve(input); cap.resolve(99); cap.reject(new RangeError("late")); log.push("after");
    assert.compareArray(log, ["before", "after"]);
    const result = await observed;
    assert.compareArray(log, ["before", "after", "reaction"]);
    assert.sameValue(result, input);
    assert.sameValue(cap.promise === previous, false);
    assert.sameValue(box.factory, Promise);
    previous = cap.promise;
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
