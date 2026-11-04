/*---
description: "Control: Each sequential loop sleep captures a fresh typed let; a queued writer is visible to the timer and to the continuation after awaiting it."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-iteration]
flags: [async]
---*/
// Captured let route; each callback and await continuation sees its own microtask-updated value. Node prints the checked log below, then Test262:AsyncTestComplete.
// before:0|micro:0:1|timer:0:1|after:0:1|before:1|micro:1:11|timer:1:11|after:1:11|before:2|micro:2:21|timer:2:21|after:2:21
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
async function main(): Promise<void> {
  for (let index = 0; index < 3; index++) {
    let value: number = index * 10;
    log.push("before:" + index);
    const asleep = new Promise<void>((resolve) => {
      const callback: () => void = () => { log.push("timer:" + index + ":" + value); resolve(); };
      enqueue(callback, 1);
    });
    const ahead = new Promise<void>((resolve) => {
      queueMicrotask(() => { value++; log.push("micro:" + index + ":" + value); resolve(); });
    });
    await ahead; pending[pending.length - 1]();
    await asleep;
    log.push("after:" + index + ":" + value);
    await ahead;
  }
  assert.compareArray(log, ["before:0", "micro:0:1", "timer:0:1", "after:0:1", "before:1", "micro:1:11", "timer:1:11", "after:1:11", "before:2", "micro:2:21", "timer:2:21", "after:2:21"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
