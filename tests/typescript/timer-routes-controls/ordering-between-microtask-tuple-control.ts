/*---
description: "Control for ordering-between-microtask-tuple: A typed callback tuple schedules tied timers that enqueue queueMicrotask before Promise reactions; Node drains that enqueue order between callbacks."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-tuples]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
async function main(): Promise<void> {
  for (const prefix of ["a", "中"]) {
    log.length = 0; pending.length = 0; const values: string[] = [], callbacks: (() => void)[] = [], gates: Promise<void>[] = [];
    for (const label of ["first", "second"]) gates.push(new Promise<void>((complete) => {
      callbacks.push(() => {
        log.push("timer:" + label); values.push(prefix + label);
        queueMicrotask(() => { log.push("queue:" + label); });
        Promise.resolve().then(() => { log.push("promise:" + label); complete(); });
      });
    }));
    const routes: [() => void, () => void] = [callbacks[0], callbacks[1]];
    enqueue(routes[0], 1); enqueue(routes[1], 1);
    log.push("sync");
    for (let index = 0; index < pending.length; index++) { pending[index](); await gates[index]; }
    await Promise.all(gates);
    assert.compareArray(log, ["sync", "timer:first", "queue:first", "promise:first", "timer:second", "queue:second", "promise:second"]);
    assert.compareArray(values, [prefix + "first", prefix + "second"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
