/*---
description: "A queued microtask uses clearInterval on a timeout carried by either narrowed union arm. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-errors, ts-null-undefined, ts-unions, ts-discriminated-unions, ts-narrowing, ts-type-aliases, ts-objects]
flags: [async]
---*/
// A discriminant selects direct or boxed handle storage; node cross-clears the timeout from the microtask and preserves its same-delay survivor. The control calls only the surviving callbacks.
const log: string[] = [];
type Route = { kind: "direct"; handle: number | undefined } | { kind: "boxed"; box: { handle: number | undefined } };
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const boxed of [false, true]) {
    log.length = 0; const seen: number[] = [], delay = 3; let fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const target = (): void => { log.push("target:" + value); seen.push(value); };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value * 10); };
    const handle = 0, route: Route = boxed ? { kind: "boxed", box: { handle } } : { kind: "direct", handle };
    const canceled = new Promise<void>((resolve) => queueMicrotask(() => { log.push("microtask:" + route.kind); try { { const cleared = route.kind === "direct" ? route.handle : route.box.handle; } } catch (error: unknown) { fault = error; log.push("caught"); } resolve(); }));
     log.push("sync"); await canceled; survivor(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["sync", boxed ? "microtask:boxed" : "microtask:direct", "survivor:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value * 10]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
