/*---
description: "Control for ordering-between-chain-generic-values: Generic number and string timers enqueue a Promise-to-queueMicrotask-to-Promise chain; Node completes each chain before the next timer."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-generics, ts-unions]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
function schedule<T>(value: T, sink: (value: T) => void): Promise<void> {
  return new Promise<void>((complete) => {
    enqueue(() => {
      log.push("timer"); sink(value);
      Promise.resolve().then(() => {
        log.push("promise:first");
        queueMicrotask(() => { log.push("queue"); Promise.resolve().then(() => { log.push("promise:last"); complete(); }); });
      });
    }, 1);
  });
}
async function main(): Promise<void> {
  for (const value of [7, -2]) {
    log.length = 0; pending.length = 0; const values: (number | string)[] = [];
    const first = schedule<number>(value, (item) => { log.push("number:" + item); values.push(item); });
    const second = schedule<string>("中", (item) => { log.push("string:" + item); values.push(item); });
    log.push("sync");
    pending[0](); await first; pending[1](); await second;
    await Promise.all([first, second]);
    assert.compareArray(log, ["sync", "timer", "number:" + value, "promise:first", "queue", "promise:last", "timer", "string:中", "promise:first", "queue", "promise:last"]);
    assert.compareArray(values, [value, "中"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
