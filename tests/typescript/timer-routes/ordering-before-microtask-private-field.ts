/*---
description: "A private callback field waits for a queueMicrotask that adds a Promise reaction; Node drains the complete queued chain before the first timer."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-private-fields, ts-this]
flags: [async]
---*/
// A private callback field waits for a queueMicrotask that adds a Promise reaction; Node drains the complete queued chain before the first timer.
const log: string[] = [];
class Scheduled {
  #callback: () => void;
  constructor(callback: () => void) { this.#callback = callback; }
  start(): void { setTimeout(this.#callback, 1); }
}
async function main(): Promise<void> {
  for (const value of ["x", "中"]) {
    log.length = 0; const values: string[] = [];
    const done = new Promise<void>((resolve) => {
      const route = new Scheduled(() => { log.push("timer"); values.push(value); resolve(); });
      route.start();
    });
    const before = new Promise<void>((ready) => {
      queueMicrotask(() => { log.push("queue"); Promise.resolve().then(() => { log.push("promise:inner"); ready(); }); });
      Promise.resolve().then(() => { log.push("promise:outer"); });
    });
    log.push("sync");
    await before;
    await done;
    assert.compareArray(log, ["sync", "queue", "promise:outer", "promise:inner", "timer"]);
    assert.compareArray(values, [value]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
