/*---
description: "An optional instance delay field carries every normalized delay between one-ms witnesses; Node preserves each field-selected callback in creation order."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-unions, ts-null-undefined]
flags: [async]
---*/
// An optional instance delay field carries every normalized delay between one-ms witnesses; Node preserves each field-selected callback in creation order.
const log: string[] = [];
class Scheduled {
  delay: number | undefined;
  constructor(delay: number | undefined) { this.delay = delay; }
  start(callback: () => void): void {
    if (this.delay === undefined) setTimeout(callback); else setTimeout(callback, this.delay);
  }
}
async function main(): Promise<void> {
  for (const offset of [0, 20]) {
    log.length = 0; const values: number[] = [];
    const delays: (number | undefined)[] = [1, 0, 1, -2, 1, NaN, 1, undefined, 1];
    const done = new Promise<void>((resolve) => {
      let remaining = delays.length;
      for (let index = 0; index < delays.length; index++) {
        const route = new Scheduled(delays[index]);
        route.start(() => { log.push("timer:" + index); values.push(offset + index); if (--remaining === 0) resolve(); });
      }
      log.push("sync");
    });
    await done;
    assert.compareArray(log, ["sync", "timer:0", "timer:1", "timer:2", "timer:3", "timer:4", "timer:5", "timer:6", "timer:7", "timer:8"]);
    assert.compareArray(values, [offset, offset + 1, offset + 2, offset + 3, offset + 4, offset + 5, offset + 6, offset + 7, offset + 8]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
