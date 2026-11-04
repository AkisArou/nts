/*---
description: "Promise.withResolvers through a constrained generic payload; node adopts the first promise and retains the exact object despite a later rejection."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-interfaces, ts-generics, ts-generic-constraints]
flags: [async]
---*/
// Promise.withResolvers through a constrained generic payload; node adopts the first promise and retains the exact object despite a later rejection.
const log: string[] = [];
interface Payload { id: number; }
function create<T extends Payload>(input: T, factory: PromiseConstructor): PromiseWithResolvers<T> {
  log.push("create:" + input.id);
  const cap: PromiseWithResolvers<T> = factory.withResolvers<T>();
  return cap;
}
async function run(): Promise<void> {
  for (const input of [{ id: 1 }, { id: 9 }]) {
    log.length = 0;
    const cap = create(input, Promise);
    const observed = cap.promise.then(value => { log.push("reaction"); return value; });
    cap.resolve(Promise.resolve(input)); cap.reject(new TypeError("late")); log.push("sync");
    assert.compareArray(log, ["create:" + input.id, "sync"]);
    const result = await observed;
    assert.compareArray(log, ["create:" + input.id, "sync", "reaction"]);
    assert.sameValue(result, input);
    assert.sameValue(result.id, input.id);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
