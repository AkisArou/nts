/*---
description: "Readonly delay arrays place zero, negative, NaN and omitted delays on both sides of one-ms entries; Node keeps each full creation sequence."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-readonly, ts-unions, ts-null-undefined]
flags: [async]
---*/
// Readonly delay arrays place zero, negative, NaN and omitted delays on both sides of one-ms entries; Node keeps each full creation sequence.
const log: string[] = [];
async function main(): Promise<void> {
  const fixtures: (readonly (number | undefined)[])[] = [[0, 1, -1, 1, NaN, 1, undefined, 1], [1, undefined, 1, NaN, 1, -1, 1, 0]];
  for (const delays of fixtures) {
    log.length = 0; const values: number[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = delays.length;
      for (let index = 0; index < delays.length; index++) {
        const callback = (): void => { log.push("timer:" + index); values.push(index * 2); if (--remaining === 0) resolve(); };
        const delay = delays[index];
        if (delay === undefined) setTimeout(callback); else setTimeout(callback, delay);
      }
      log.push("sync");
    });
    await done;
    assert.compareArray(log, ["sync", "timer:0", "timer:1", "timer:2", "timer:3", "timer:4", "timer:5", "timer:6", "timer:7"]);
    assert.compareArray(values, [0, 2, 4, 6, 8, 10, 12, 14]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
