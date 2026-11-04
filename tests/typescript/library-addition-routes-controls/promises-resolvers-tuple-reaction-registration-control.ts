/*---
description: "Control: Promise.withResolvers through a constructor tuple; node queues reactions registered before and after settlement in registration order."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-tuples]
flags: [async]
---*/
// Promise.withResolvers through a constructor tuple; node queues reactions registered before and after settlement in registration order.
const log: string[] = [];
const source: [string, PromiseConstructor] = ["factory", Promise];
async function run(): Promise<void> {
  for (const input of [4, -0]) {
    log.length = 0;
    const factory = source[1];
    let capResolve: (value: number | PromiseLike<number>) => void = () => {};
    let capReject: (reason?: unknown) => void = () => {};
    const capPromise = new factory<number>((resolve, reject) => { capResolve = resolve; capReject = reject; });
    const cap: PromiseWithResolvers<number> = { promise: capPromise, resolve: capResolve, reject: capReject };
    const before = cap.promise.then(value => { log.push("before"); return value; });
    cap.resolve(input);
    const after = cap.promise.then(value => { log.push("after"); return value; });
    log.push("sync");
    assert.compareArray(log, ["sync"]);
    const values = await Promise.all([before, after]);
    assert.compareArray(log, ["sync", "before", "after"]);
    assert.compareArray(values, [input, input]);
    assert.sameValue(source[1], Promise);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
