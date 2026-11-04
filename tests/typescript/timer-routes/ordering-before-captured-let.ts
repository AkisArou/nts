/*---
description: "A callback captures one mutable typed let across synchronous and queued writes; Node observes all pre-timer writes and runs after their complete log."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown]
flags: [async]
---*/
// A callback captures one mutable typed let across synchronous and queued writes; Node observes all pre-timer writes and runs after their complete log.
const log: string[] = [];
async function main(): Promise<void> {
  for (const initial of [2, -5]) {
    log.length = 0; const values: number[] = [];
    let current: number = initial;
    const done = new Promise<void>((resolve) => {
      const callback: () => void = () => { log.push("timer:" + current); values.push(current); resolve(); };
      setTimeout(callback, 1);
    });
    current += 1; log.push("sync:" + current);
    const before = new Promise<void>((ready) => {
      queueMicrotask(() => {
        log.push("queue:" + current); current += 2;
        Promise.resolve().then(() => { log.push("promise:" + current); current += 4; ready(); });
      });
    });
    await before;
    await done;
    assert.compareArray(log, ["sync:" + (initial + 1), "queue:" + (initial + 1), "promise:" + (initial + 3), "timer:" + (initial + 7)]);
    assert.compareArray(values, [initial + 7]);
    assert.sameValue(current, initial + 7);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
