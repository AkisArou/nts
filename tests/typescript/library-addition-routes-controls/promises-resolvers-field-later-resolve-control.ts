/*---
description: "Control: Promise.withResolvers through a class constructor field with a saved resolver field; node remains pending until the later field call and preserves the first value."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-class, ts-class-fields]
flags: [async]
---*/
// Promise.withResolvers through a class constructor field with a saved resolver field; node remains pending until the later field call and preserves the first value.
const log: string[] = [];
class Deferred {
  factory: PromiseConstructor = Promise;
  promise: Promise<number>;
  resolve: (value: number | PromiseLike<number>) => void;
  constructor() {
    log.push("construct");
    const factory = this.factory;
    let capResolve: (value: number | PromiseLike<number>) => void = () => {};
    let capReject: (reason?: unknown) => void = () => {};
    const capPromise = new factory<number>((resolve, reject) => { capResolve = resolve; capReject = reject; });
    const cap: PromiseWithResolvers<number> = { promise: capPromise, resolve: capResolve, reject: capReject };
    this.promise = cap.promise; this.resolve = cap.resolve;
  }
}
async function run(): Promise<void> {
  for (const input of [3, -0]) {
    log.length = 0;
    const holder = new Deferred();
    const observed = holder.promise.then(value => { log.push("reaction"); return value; });
    await Promise.resolve();
    assert.compareArray(log, ["construct"]);
    holder.resolve(input); holder.resolve(90); log.push("settled");
    const result = await observed;
    assert.compareArray(log, ["construct", "settled", "reaction"]);
    assert.sameValue(result, input);
    assert.sameValue(holder.factory, Promise);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
