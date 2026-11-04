/*---
description: "Control: Promise.withResolvers through a captured constructor and capability binding; node calls the current resolver while an older capability remains independent."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-closures, ts-arrow-functions]
flags: [async]
---*/
// Promise.withResolvers through a captured constructor and capability binding; node calls the current resolver while an older capability remains independent.
const log: string[] = [];
let factory: PromiseConstructor = Promise;
function create(): PromiseWithResolvers<number> {
  log.push("create");
  let capResolve: (value: number | PromiseLike<number>) => void = () => {};
  let capReject: (reason?: unknown) => void = () => {};
  const capPromise = new factory<number>((resolve, reject) => { capResolve = resolve; capReject = reject; });
  const cap: PromiseWithResolvers<number> = { promise: capPromise, resolve: capResolve, reject: capReject };
  return cap;
}
async function run(): Promise<void> {
  for (const input of [5, 12]) {
    log.length = 0;
    let current: PromiseWithResolvers<number> = create();
    const first = current;
    const a = first.promise.then(value => { log.push("first"); return value; });
    const settle = (value: number): void => { log.push("settle"); current.resolve(value); };
    current = create();
    const b = current.promise.then(value => { log.push("current"); return value; });
    settle(input); first.resolve(input + 1); log.push("sync");
    const values = await Promise.all([a, b]);
    assert.compareArray(log, ["create", "create", "settle", "sync", "current", "first"]);
    assert.compareArray(values, [input + 1, input]);
    assert.sameValue(first.promise === current.promise, false);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
