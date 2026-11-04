/*---
description: "Promise.withResolvers through static constructor and resolver fields; node starts fresh on each installation and ignores a second later resolve."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-static]
flags: [async]
---*/
// Promise.withResolvers through static constructor and resolver fields; node starts fresh on each installation and ignores a second later resolve.
const log: string[] = [];
class Registry {
  static factory: PromiseConstructor = Promise;
  static resolve: (value: number) => void = () => {};
  static create(): Promise<number> {
    log.push("create");
    const factory = Registry.factory;
    const cap: PromiseWithResolvers<number> = factory.withResolvers<number>();
    Registry.resolve = cap.resolve; return cap.promise;
  }
  static settle(value: number): void { log.push("settle"); Registry.resolve(value); }
}
async function run(): Promise<void> {
  for (const input of [11, -0]) {
    log.length = 0;
    const promise = Registry.create();
    const observed = promise.then(value => { log.push("reaction"); return value; });
    Registry.settle(input); Registry.settle(99); log.push("sync");
    assert.compareArray(log, ["create", "settle", "settle", "sync"]);
    const result = await observed;
    assert.compareArray(log, ["create", "settle", "settle", "sync", "reaction"]);
    assert.sameValue(result, input);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
