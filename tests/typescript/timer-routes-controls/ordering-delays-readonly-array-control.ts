/*---
description: "Control for ordering-delays-readonly-array: Readonly delay arrays retain out-of-order registration and repeated delays; Node records short, middle and long callbacks in stable groups."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-readonly]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
async function main(): Promise<void> {
  for (const label of ["x", "中"]) {
    log.length = 0; pending.length = 0; const values: string[] = [];
    const delays: readonly number[] = [25, 10, 1, 10, 1, 25];
    const done = new Promise<void>((resolve) => {
      let remaining = delays.length;
      for (let index = 0; index < delays.length; index++) {
        const callback = (): void => { log.push("timer:" + index); values.push(label + index); if (--remaining === 0) resolve(); };
        enqueue(callback, delays[index]);
      }
      log.push("sync:" + label);
    });
    for (const index of [2, 4, 1, 3, 0, 5]) pending[index]();
    await done;
    assert.compareArray(log, ["sync:" + label, "timer:2", "timer:4", "timer:1", "timer:3", "timer:0", "timer:5"]);
    assert.compareArray(values, [label + 2, label + 4, label + 1, label + 3, label + 0, label + 5]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
