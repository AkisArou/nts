/*---
description: "Promise.withResolvers through a readonly constructor field; node locks to the first still-pending promise before later settlement attempts."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-interfaces, ts-readonly, ts-closures]
flags: [async]
---*/
// Promise.withResolvers through a readonly constructor field; node locks to the first still-pending promise before later settlement attempts.
const log: string[] = [];
interface Source { readonly factory: PromiseConstructor; }
const source: Source = { factory: Promise };
async function run(): Promise<void> {
  for (const input of [23, -0]) {
    log.length = 0;
    const factory = source.factory;
    const cap: PromiseWithResolvers<number> = factory.withResolvers<number>();
    let release: (value: number) => void = () => {};
    const pending = new Promise<number>(resolve => { log.push("executor"); release = resolve; });
    const observed = cap.promise.then(value => { log.push("reaction"); return value; });
    cap.resolve(pending); cap.resolve(99); cap.reject(new RangeError("late")); log.push("sync");
    await Promise.resolve();
    assert.compareArray(log, ["executor", "sync"]);
    release(input); log.push("release");
    const result = await observed;
    assert.compareArray(log, ["executor", "sync", "release", "reaction"]);
    assert.sameValue(result, input);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
