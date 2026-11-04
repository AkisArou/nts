/*---
description: "Control for ordering-ties-private-field: Private callback fields select each instance callback before equal-delay timers run; Node preserves three independent values in creation order."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-private-fields, ts-this]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
class Scheduled {
  #callback: () => void;
  constructor(callback: () => void) { this.#callback = callback; }
  start(delay: number): void { enqueue(this.#callback, delay); }
}
async function main(): Promise<void> {
  for (const prefix of ["a", "中"]) {
    log.length = 0; pending.length = 0; const values: string[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = 3;
      for (const suffix of ["2", "0", "1"]) {
        const route = new Scheduled(() => { log.push("timer:" + suffix); values.push(prefix + suffix); if (--remaining === 0) resolve(); });
        route.start(1);
      }
      log.push("sync");
    });
    for (const callback of pending) callback();
    await done;
    assert.compareArray(log, ["sync", "timer:2", "timer:0", "timer:1"]);
    assert.compareArray(values, [prefix + "2", prefix + "0", prefix + "1"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
