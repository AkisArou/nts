/*---
description: "Tuple delay/value routes create 30, 1, 15, 1, 30 and 15 ms timers; Node fires ties in creation order after synchronous code."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-tuples]
flags: [async]
---*/
// Tuple delay/value routes create 30, 1, 15, 1, 30 and 15 ms timers; Node fires ties in creation order after synchronous code.
const log: string[] = [];
async function main(): Promise<void> {
  for (const offset of [0, 10]) {
    log.length = 0; const values: number[] = [];
    const inputs: [number, string, number][] = [[30, "a", offset + 1], [1, "b", offset + 2], [15, "c", offset + 3], [1, "d", offset + 4], [30, "e", offset + 5], [15, "f", offset + 6]];
    const done = new Promise<void>((resolve) => {
      let remaining = inputs.length;
      for (const [delay, label, value] of inputs) {
        const callback = (): void => { log.push(label); values.push(value); if (--remaining === 0) resolve(); };
        setTimeout(callback, delay);
      }
      log.push("sync");
    });
    await done;
    assert.compareArray(log, ["sync", "b", "d", "c", "f", "a", "e"]);
    assert.compareArray(values, [offset + 2, offset + 4, offset + 3, offset + 6, offset + 1, offset + 5]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
