/*---
description: "Control for ordering-nested-generic-values: A number timer schedules a generic string timer while number and string timers already wait; Node retains both type instantiations and appends the child last."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-generics, ts-unions]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
function schedule<T>(value: T, sink: (value: T) => void): void { enqueue(() => sink(value), 1); }
async function main(): Promise<void> {
  for (const value of [7, -4]) {
    log.length = 0; pending.length = 0; const values: (number | string)[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = 4;
      const record = (label: string, item: number | string): void => { log.push(label); values.push(item); if (--remaining === 0) resolve(); };
      schedule<number>(value, (item) => {
        record("parent", item);
        schedule<string>("child", (child) => { record("child", child); });
      });
      schedule<string>("waiting", (item) => { record("waiting:string", item); });
      schedule<number>(value + 1, (item) => { record("waiting:number", item); });
      log.push("sync");
    });
    for (const callback of pending) callback();
    await done;
    assert.compareArray(log, ["sync", "parent", "waiting:string", "waiting:number", "child"]);
    assert.compareArray(values, [value, "waiting", value + 1, "child"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
