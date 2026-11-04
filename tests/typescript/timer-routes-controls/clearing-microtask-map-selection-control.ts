/*---
description: "A microtask cancels only the timeout selected through a Map lookup. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-map-set, ts-errors, ts-null-undefined, ts-unions]
flags: [async]
---*/
// The queued microtask selects a named Map handle; node preserves the unselected callback value and never runs the canceled callback. The control calls only the surviving callbacks.
const log: string[] = [];
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const selected of [0, 1]) {
    log.length = 0; const handles = new Map<string, number>(), values = [value, value + 1], seen: number[] = [], callbacks: (() => void)[] = [], delay = 3; let fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    for (let index = 0; index < values.length; index++) { const item = values[index]; callbacks.push(() => { log.push("fire:" + index + ":" + item); seen.push(item); }); }
    for (let index = 0; index < callbacks.length; index++) handles.set(String(index), 0);
    const canceled = new Promise<void>((resolve) => queueMicrotask(() => { log.push("microtask:" + selected); try { { const cleared = handles.get(String(selected)); } } catch (error: unknown) { fault = error; log.push("caught"); } resolve(); }));
     log.push("sync"); await canceled; callbacks[1 - selected](); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["sync", "microtask:" + selected, "fire:" + (1 - selected) + ":" + values[1 - selected], "sentinel", "after"]);
    assert.compareArray(seen, [values[1 - selected]]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
