/*---
description: "Promise.withResolvers through a discriminated constructor union; node keeps the first rejection and ignores both a resolve and a second rejection."
features: [ts-library-addition-routes, ts-library-addition-route-promises, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-unions, ts-narrowing, ts-errors, ts-instanceof]
flags: [async]
---*/
// Promise.withResolvers through a discriminated constructor union; node keeps the first rejection and ignores both a resolve and a second rejection.
const log: string[] = [];
type Source = { kind: "factory"; value: PromiseConstructor } | { kind: "absent" };
const sources: Source[] = [{ kind: "factory", value: Promise }, { kind: "absent" }, { kind: "factory", value: Promise }];
async function run(): Promise<void> {
  for (const source of sources) {
    log.length = 0;
    if (source.kind === "absent") { log.push("skip"); assert.compareArray(log, ["skip"]); continue; }
    const factory = source.value;
    const cap: PromiseWithResolvers<number> = factory.withResolvers<number>();
    const reason = new RangeError("first");
    const observed = cap.promise.then(value => { log.push("unexpected"); return value; }, (error: unknown) => { log.push("reject"); return error; });
    cap.reject(reason); cap.resolve(17); cap.reject(new TypeError("second")); log.push("sync");
    assert.compareArray(log, ["sync"]);
    const result = await observed;
    assert.compareArray(log, ["sync", "reject"]);
    assert.sameValue(result, reason);
    assert.sameValue(result instanceof RangeError, true);
  }
}
run().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
