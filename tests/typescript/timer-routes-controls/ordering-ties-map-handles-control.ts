/*---
description: "Control for ordering-ties-map-handles: Named opaque handles are stored in a Map and read only for clearing after all callbacks; tied timers still retain registration order."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-map-set]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
async function main(): Promise<void> {
  for (const delay of [1, 4]) {
    log.length = 0; pending.length = 0; const values: string[] = [];
    const handles: Map<string, number> = new Map();
    const done = new Promise<void>((resolve) => {
      let remaining = 2;
      for (const name of ["b", "a"]) {
        const callback = (): void => { log.push("timer:" + name); values.push(name + name); if (--remaining === 0) resolve(); };
        handles.set(name, enqueue(callback, delay));
      }
      log.push("sync");
    });
    for (const callback of pending) callback();
    await done;
    handles.get("a"); handles.get("b");
    assert.compareArray(log, ["sync", "timer:b", "timer:a"]);
    assert.compareArray(values, ["bb", "aa"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
