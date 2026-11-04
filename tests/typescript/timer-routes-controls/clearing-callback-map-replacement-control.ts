/*---
description: "A controller timer clears the replacement handle read from a Map. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-map-set, ts-errors, ts-null-undefined, ts-unions]
flags: [async]
---*/
// The current Map value is replaced before callbacks run; node clears that newer timeout while the older callback still delivers its value. The control calls only the surviving callbacks.
const log: string[] = [];
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const handles = new Map<string, number>(), seen: number[] = []; let fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const first = (): void => { log.push("first:" + value); seen.push(value); };
    const second = (): void => { log.push("second:" + value); seen.push(value * 10); };
    const controller = (): void => { log.push("controller"); try { { const cleared = handles.get("current"); } } catch (error: unknown) { fault = error; log.push("caught"); } };
     handles.set("current", 0); handles.set("current", 0); log.push("replaced");
     log.push("sync"); await Promise.resolve(); controller(); first(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["replaced", "sync", "controller", "first:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
