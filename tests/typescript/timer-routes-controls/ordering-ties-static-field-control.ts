/*---
description: "Control for ordering-ties-static-field: A static callback field is replaced between registrations; each equal-delay timer retains the callback selected when scheduled."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-static]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
class Scheduled { static callback: () => void = () => { log.push("unused"); }; }
async function main(): Promise<void> {
  for (const offset of [0, 20]) {
    log.length = 0; pending.length = 0; const values: number[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = 3;
      for (const value of [3, 1, 2]) {
        Scheduled.callback = () => { log.push("timer:" + value); values.push(offset + value); if (--remaining === 0) resolve(); };
        enqueue(Scheduled.callback, 1);
      }
      Scheduled.callback = () => { log.push("replacement"); };
      log.push("sync");
    });
    for (const callback of pending) callback();
    await done;
    assert.compareArray(log, ["sync", "timer:3", "timer:1", "timer:2"]);
    assert.compareArray(values, [offset + 3, offset + 1, offset + 2]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
