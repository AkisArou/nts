/*---
description: "A typed callback tuple schedules tied timers that enqueue queueMicrotask before Promise reactions; Node drains that enqueue order between callbacks."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-tuples]
flags: [async]
---*/
// A typed callback tuple schedules tied timers that enqueue queueMicrotask before Promise reactions; Node drains that enqueue order between callbacks.
const log: string[] = [];
async function main(): Promise<void> {
  for (const prefix of ["a", "中"]) {
    log.length = 0; const values: string[] = [], callbacks: (() => void)[] = [], gates: Promise<void>[] = [];
    for (const label of ["first", "second"]) gates.push(new Promise<void>((complete) => {
      callbacks.push(() => {
        log.push("timer:" + label); values.push(prefix + label);
        queueMicrotask(() => { log.push("queue:" + label); });
        Promise.resolve().then(() => { log.push("promise:" + label); complete(); });
      });
    }));
    const routes: [() => void, () => void] = [callbacks[0], callbacks[1]];
    setTimeout(routes[0], 1); setTimeout(routes[1], 1);
    log.push("sync");
    await Promise.all(gates);
    assert.compareArray(log, ["sync", "timer:first", "queue:first", "promise:first", "timer:second", "queue:second", "promise:second"]);
    assert.compareArray(values, [prefix + "first", prefix + "second"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
