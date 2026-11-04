/*---
description: "Control: Promise.withResolvers through a private constructor and reject field; node rejects only on the later private call and retains the error identity."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-errors, ts-instanceof]
flags: [async]
---*/
// Promise.withResolvers through a private constructor and reject field; node rejects only on the later private call and retains the error identity.
const log: string[] = [];
class Deferred {
  #factory: PromiseConstructor = Promise;
  #reject: (reason?: unknown) => void;
  promise: Promise<number>;
  constructor() {
    log.push("construct");
    const factory = this.#factory;
    let capResolve: (value: number | PromiseLike<number>) => void = () => {};
    let capReject: (reason?: unknown) => void = () => {};
    const capPromise = new factory<number>((resolve, reject) => { capResolve = resolve; capReject = reject; });
    const cap: PromiseWithResolvers<number> = { promise: capPromise, resolve: capResolve, reject: capReject };
    this.promise = cap.promise; this.#reject = cap.reject;
  }
  fail(reason: Error): void { log.push("fail"); this.#reject(reason); }
}
async function run(): Promise<void> {
  for (const reason of [new RangeError("one"), new TypeError("two")]) {
    log.length = 0;
    const holder = new Deferred();
    const observed = holder.promise.then(value => { log.push("unexpected"); return value; }, (error: unknown) => { log.push("reject"); return error; });
    await Promise.resolve();
    assert.compareArray(log, ["construct"]);
    holder.fail(reason); log.push("sync");
    const result = await observed;
    assert.compareArray(log, ["construct", "fail", "sync", "reject"]);
    assert.sameValue(result, reason);
    assert.sameValue(result instanceof Error, true);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
