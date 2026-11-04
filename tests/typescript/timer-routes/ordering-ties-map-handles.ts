/*---
description: "Named opaque handles are stored in a Map and read only for clearing after all callbacks; tied timers still retain registration order."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-map-set]
flags: [async]
---*/
// Named opaque handles are stored in a Map and read only for clearing after all callbacks; tied timers still retain registration order.
const log: string[] = [];
async function main(): Promise<void> {
  for (const delay of [1, 4]) {
    log.length = 0; const values: string[] = [];
    const handles: Map<string, number> = new Map();
    const done = new Promise<void>((resolve) => {
      let remaining = 2;
      for (const name of ["b", "a"]) {
        const callback = (): void => { log.push("timer:" + name); values.push(name + name); if (--remaining === 0) resolve(); };
        handles.set(name, setTimeout(callback, delay));
      }
      log.push("sync");
    });
    await done;
    clearTimeout(handles.get("a")); clearTimeout(handles.get("b"));
    assert.compareArray(log, ["sync", "timer:b", "timer:a"]);
    assert.compareArray(values, ["bb", "aa"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
