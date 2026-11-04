/*---
description: "A controller callback retains the saved old handle after a captured current handle is replaced. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-errors, ts-null-undefined, ts-unions]
flags: [async]
---*/
// Separate captured bindings hold saved and current handles; node cancels the saved first target and preserves the replacement callback. The control calls only the surviving callbacks.
const log: string[] = [];
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const seen: number[] = []; let current: number | undefined, saved: number | undefined, fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const first = (): void => { log.push("first:" + value); seen.push(value); };
    const second = (): void => { log.push("second:" + value); seen.push(value * 10); };
    const controller = (): void => { log.push("clear-saved"); try { { const cleared = saved; } } catch (error: unknown) { fault = error; log.push("caught"); } };
     current = 0; saved = current; current = 0;
     log.push("sync"); await Promise.resolve(); controller(); second(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["sync", "clear-saved", "second:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value * 10]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
