/*---
description: "A timer callback can clear a missing Map handle through either clear function. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-map-set, ts-errors, ts-null-undefined, ts-unions]
flags: [async]
---*/
// A missing Map lookup supplies undefined inside a timer callback; node leaves the separately stored live timer active and throws no error. The control calls only the surviving callbacks.
const log: string[] = [];
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const key of ["absent", "other"]) {
    log.length = 0; const handles = new Map<string, number>(), seen: number[] = [], delay = 3; let fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value); };
    const controller = (): void => { log.push("clear-missing:" + key); try { { const cleared = handles.get(key); } { const cleared = handles.get(key); } } catch (error: unknown) { fault = error; log.push("caught"); } };
     handles.set("live", 0);  log.push("sync"); await Promise.resolve(); controller(); survivor(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["sync", "clear-missing:" + key, "survivor:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
