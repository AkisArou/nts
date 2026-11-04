/*---
description: "Callbacks stored in instance fields retain their registration order and captured values across two equal-delay batches."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// Callbacks stored in instance fields retain their registration order and captured values across two equal-delay batches.
const log: string[] = [];
class Scheduled {
  callback: () => void;
  constructor(callback: () => void) { this.callback = callback; }
  start(delay: number): void { setTimeout(this.callback, delay); }
}
async function main(): Promise<void> {
  for (const delay of [1, 5]) {
    log.length = 0; const values: number[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = 3;
      for (const value of [9, -2, 4]) {
        const route = new Scheduled(() => { log.push("timer:" + value); values.push(value); if (--remaining === 0) resolve(); });
        route.start(delay);
      }
      log.push("sync");
    });
    await done;
    assert.compareArray(log, ["sync", "timer:9", "timer:-2", "timer:4"]);
    assert.compareArray(values, [9, -2, 4]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
