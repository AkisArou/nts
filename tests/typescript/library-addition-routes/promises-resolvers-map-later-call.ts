/*---
description: "Promise.withResolvers through a Map constructor and capability value; node preserves a resolver retrieved later and keeps the first settlement."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-map-set, ts-narrowing]
flags: [async]
---*/
// Promise.withResolvers through a Map constructor and capability value; node preserves a resolver retrieved later and keeps the first settlement.
const log: string[] = [];
const constructors: Map<string, PromiseConstructor> = new Map([["factory", Promise]]);
async function run(): Promise<void> {
  for (const input of [19, -0]) {
    log.length = 0;
    const factory = constructors.get("factory");
    if (factory === undefined) throw new Error("missing factory");
    const cap: PromiseWithResolvers<number> = factory.withResolvers<number>();
    const saved: Map<string, PromiseWithResolvers<number>> = new Map([["pending", cap]]);
    const observed = cap.promise.then(value => { log.push("reaction"); return value; });
    await Promise.resolve();
    assert.compareArray(log, []);
    const later = saved.get("pending");
    if (later === undefined) throw new Error("missing capability");
    log.push("later"); later.resolve(input); later.reject(new Error("late")); log.push("sync");
    const result = await observed;
    assert.compareArray(log, ["later", "sync", "reaction"]);
    assert.sameValue(result, input);
    assert.sameValue(later, cap);
    assert.sameValue(saved.get("pending"), cap);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
