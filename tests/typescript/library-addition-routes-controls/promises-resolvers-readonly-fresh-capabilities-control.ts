/*---
description: "Control: Promise.withResolvers through a readonly constructor array; node returns independent promises and resolvers, with reactions ordered by settlement."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-readonly]
flags: [async]
---*/
// Promise.withResolvers through a readonly constructor array; node returns independent promises and resolvers, with reactions ordered by settlement.
const log: string[] = [];
const sources: readonly PromiseConstructor[] = [Promise, Promise];
async function run(): Promise<void> {
  for (const factory of sources) {
    log.length = 0;
    let firstResolve: (value: number | PromiseLike<number>) => void = () => {};
    let firstReject: (reason?: unknown) => void = () => {};
    const firstPromise = new factory<number>((resolve, reject) => { firstResolve = resolve; firstReject = reject; });
    const first: PromiseWithResolvers<number> = { promise: firstPromise, resolve: firstResolve, reject: firstReject };
    let secondResolve: (value: number | PromiseLike<number>) => void = () => {};
    let secondReject: (reason?: unknown) => void = () => {};
    const secondPromise = new factory<number>((resolve, reject) => { secondResolve = resolve; secondReject = reject; });
    const second: PromiseWithResolvers<number> = { promise: secondPromise, resolve: secondResolve, reject: secondReject };
    const a = first.promise.then(value => { log.push("first"); return value; });
    const b = second.promise.then(value => { log.push("second"); return value; });
    assert.sameValue(first === second, false);
    assert.sameValue(first.promise === second.promise, false);
    assert.sameValue(first.resolve === second.resolve, false);
    assert.sameValue(first.reject === second.reject, false);
    second.resolve(20); first.resolve(10); log.push("sync");
    assert.compareArray(log, ["sync"]);
    const values = await Promise.all([a, b]);
    assert.compareArray(log, ["sync", "second", "first"]);
    assert.compareArray(values, [10, 20]);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
