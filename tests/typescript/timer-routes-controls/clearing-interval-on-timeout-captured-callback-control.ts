/*---
description: "A controller callback uses clearInterval on a timeout handle read from a captured binding. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-errors, ts-null-undefined, ts-unions]
flags: [async]
---*/
// The controller captures a let assigned later in the synchronous run; node uses clearInterval to cancel that timeout before its opportunity. The control calls only the surviving callbacks.
const log: string[] = [];
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const seen: number[] = []; let pending: number | undefined, fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const target = (): void => { log.push("target:" + value); seen.push(value); };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value * 10); };
    const controller = (): void => { log.push("clear-interval"); try { { const cleared = pending; } } catch (error: unknown) { fault = error; log.push("caught"); } };
     pending = 0;   log.push("sync");
    await Promise.resolve(); controller(); survivor(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["sync", "clear-interval", "survivor:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value * 10]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
