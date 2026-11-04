/*---
description: "Control for ordering-before-promise-class-field: Class callback fields wait until a queued Promise chain and queueMicrotask finish; Node logs sync, both Promise steps and the queue job before either timer."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
class Scheduled { callback: () => void; constructor(callback: () => void) { this.callback = callback; } }
async function main(): Promise<void> {
  for (const value of [3, -4]) {
    log.length = 0; pending.length = 0; const values: number[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = 2;
      for (const increment of [0, 1]) {
        const route = new Scheduled(() => { log.push("timer:" + increment); values.push(value + increment); if (--remaining === 0) resolve(); });
        enqueue(route.callback, 1);
      }
    });
    const before = new Promise<void>((ready) => {
      Promise.resolve(value).then((item) => { log.push("promise:first"); return item + 1; }).then((item) => { log.push("promise:" + item); ready(); });
      queueMicrotask(() => { log.push("queue"); });
    });
    log.push("sync");
    await before;
    for (const callback of pending) callback();
    await done;
    assert.compareArray(log, ["sync", "promise:first", "queue", "promise:" + (value + 1), "timer:0", "timer:1"]);
    assert.compareArray(values, [value, value + 1]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
