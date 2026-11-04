/*---
description: "Control: Promise.withResolvers through a class accessor constructor; node reads it once and rejects self-resolution with TypeError before ignoring later resolves."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-class, ts-accessors, ts-errors, ts-instanceof]
flags: [async]
---*/
// Promise.withResolvers through a class accessor constructor; node reads it once and rejects self-resolution with TypeError before ignoring later resolves.
const log: string[] = [];
class Source { get factory(): PromiseConstructor { log.push("factory"); return Promise; } }
const source = new Source();
async function run(): Promise<void> {
  for (const input of [3, 8]) {
    log.length = 0;
    const factory = source.factory;
    let capResolve: (value: number | PromiseLike<number>) => void = () => {};
    let capReject: (reason?: unknown) => void = () => {};
    const capPromise = new factory<number>((resolve, reject) => { capResolve = resolve; capReject = reject; });
    const cap: PromiseWithResolvers<number> = { promise: capPromise, resolve: capResolve, reject: capReject };
    const observed = cap.promise.then(value => { log.push("unexpected"); return value; }, (error: unknown) => { log.push("reject"); return error; });
    cap.resolve(cap.promise); cap.resolve(input); log.push("sync");
    assert.compareArray(log, ["factory", "sync"]);
    const result = await observed;
    assert.compareArray(log, ["factory", "sync", "reject"]);
    assert.sameValue(result instanceof TypeError, true);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
