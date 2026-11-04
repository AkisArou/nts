/*---
description: "Control for ordering-nested-loop-bindings: Fresh typed for-of let bindings survive queued parents and children; Node runs every waiting parent before the children and retains each independent write."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
async function main(): Promise<void> {
  for (const multiplier of [1, 2]) {
    log.length = 0; pending.length = 0; const values: number[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = 3;
      for (let current of [2, 5, 9]) {
        const parent: () => void = () => {
          log.push("parent:" + current);
          enqueue(() => { log.push("child:" + current); values.push(current); if (--remaining === 0) resolve(); }, 1);
          current += 1;
        };
        enqueue(parent, 1);
        current *= multiplier;
      }
      log.push("sync");
    });
    for (const callback of pending) callback();
    await done;
    assert.compareArray(log, ["sync", "parent:" + (2 * multiplier), "parent:" + (5 * multiplier), "parent:" + (9 * multiplier), "child:" + (2 * multiplier + 1), "child:" + (5 * multiplier + 1), "child:" + (9 * multiplier + 1)]);
    assert.compareArray(values, [2 * multiplier + 1, 5 * multiplier + 1, 9 * multiplier + 1]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
