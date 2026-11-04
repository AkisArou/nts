/*---
description: "Control for ordering-between-promise-readonly-callbacks: A readonly callback array schedules tied timers that enqueue Promise then queueMicrotask jobs; Node drains both jobs before the next callback."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-readonly]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
async function main(): Promise<void> {
  for (const offset of [0, 10]) {
    log.length = 0; pending.length = 0; const values: number[] = [], callbacks: (() => void)[] = [], gates: Promise<void>[] = [];
    for (const value of [1, 2, 3]) gates.push(new Promise<void>((complete) => {
      callbacks.push(() => {
        log.push("timer:" + value); values.push(offset + value);
        Promise.resolve().then(() => { log.push("promise:" + value); });
        queueMicrotask(() => { log.push("queue:" + value); complete(); });
      });
    }));
    const routes: readonly (() => void)[] = callbacks;
    for (const callback of routes) enqueue(callback, 1);
    log.push("sync");
    for (let index = 0; index < pending.length; index++) { pending[index](); await gates[index]; }
    await Promise.all(gates);
    assert.compareArray(log, ["sync", "timer:1", "promise:1", "queue:1", "timer:2", "promise:2", "queue:2", "timer:3", "promise:3", "queue:3"]);
    assert.compareArray(values, [offset + 1, offset + 2, offset + 3]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
