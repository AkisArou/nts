/*---
description: "A nested queued microtask clears the latest captured handle before any timer callback. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-errors, ts-null-undefined, ts-unions]
flags: [async]
---*/
// Two queued microtasks lead to a captured let read; node drains both before timer callbacks, canceling the replacement and delivering the earlier value. The control calls only the surviving callbacks.
const log: string[] = [];
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const seen: number[] = []; let current: number | undefined, fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const first = (): void => { log.push("first:" + value); seen.push(value); };
    const second = (): void => { log.push("second:" + value); seen.push(value * 10); };
    current = 0;
    const canceled = new Promise<void>((resolve) => queueMicrotask(() => { log.push("outer-microtask"); queueMicrotask(() => { log.push("inner-microtask"); try { { const cleared = current; } } catch (error: unknown) { fault = error; log.push("caught"); } resolve(); }); }));
    current = 0;  log.push("sync"); await canceled; first(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["sync", "outer-microtask", "inner-microtask", "first:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
