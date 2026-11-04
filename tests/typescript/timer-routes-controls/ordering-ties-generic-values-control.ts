/*---
description: "Control for ordering-ties-generic-values: Generic scheduling at number and string instantiations retains both values and the cross-instantiation creation order of tied timers."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-generics, ts-unions]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
function schedule<T>(value: T, delay: number, sink: (value: T) => void): void { enqueue(() => sink(value), delay); }
async function main(): Promise<void> {
  for (const offset of [0, 10]) {
    log.length = 0; pending.length = 0; const values: (number | string)[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = 4;
      const numberSink = (value: number): void => { log.push("number:" + value); values.push(value); if (--remaining === 0) resolve(); };
      const stringSink = (value: string): void => { log.push("string:" + value); values.push(value); if (--remaining === 0) resolve(); };
      schedule<number>(offset + 2, 1, numberSink); schedule<string>("中", 1, stringSink);
      schedule<number>(offset - 1, 1, numberSink); schedule<string>("", 1, stringSink);
      log.push("sync");
    });
    for (const callback of pending) callback();
    await done;
    assert.compareArray(log, ["sync", "number:" + (offset + 2), "string:中", "number:" + (offset - 1), "string:"]);
    assert.compareArray(values, [offset + 2, "中", offset - 1, ""]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
