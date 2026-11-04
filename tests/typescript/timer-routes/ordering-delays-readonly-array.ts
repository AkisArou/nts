/*---
description: "Readonly delay arrays retain out-of-order registration and repeated delays; Node records short, middle and long callbacks in stable groups."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-readonly]
flags: [async]
---*/
// Readonly delay arrays retain out-of-order registration and repeated delays; Node records short, middle and long callbacks in stable groups.
const log: string[] = [];
async function main(): Promise<void> {
  for (const label of ["x", "中"]) {
    log.length = 0; const values: string[] = [];
    const delays: readonly number[] = [25, 10, 1, 10, 1, 25];
    const done = new Promise<void>((resolve) => {
      let remaining = delays.length;
      for (let index = 0; index < delays.length; index++) {
        const callback = (): void => { log.push("timer:" + index); values.push(label + index); if (--remaining === 0) resolve(); };
        setTimeout(callback, delays[index]);
      }
      log.push("sync:" + label);
    });
    await done;
    assert.compareArray(log, ["sync:" + label, "timer:2", "timer:4", "timer:1", "timer:3", "timer:0", "timer:5"]);
    assert.compareArray(values, [label + 2, label + 4, label + 1, label + 3, label + 0, label + 5]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
