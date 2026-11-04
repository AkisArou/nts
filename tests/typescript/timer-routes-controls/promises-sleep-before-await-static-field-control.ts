/*---
description: "Control: A static callback field queues a promise reaction then a microtask before resolving a sleep; awaiting observes both in that order."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-class, ts-class-fields, ts-static, ts-iteration]
flags: [async]
---*/
// Static callback field route; a timer promise preserves the jobs queued ahead of its await reaction. Node prints the checked log below, then Test262:AsyncTestComplete.
// before:a|timer:a|promise:a|micro:a|after:a|before:b|timer:b|promise:b|micro:b|after:b
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
class StaticSleeper {
  static callback: () => void = () => {};
  static sleep(label: string, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      StaticSleeper.callback = () => {
        log.push("timer:" + label);
        Promise.resolve().then(() => { log.push("promise:" + label); });
        queueMicrotask(() => { log.push("micro:" + label); });
        resolve();
      };
      enqueue(StaticSleeper.callback, ms);
    });
  }
}
async function main(): Promise<void> {
  for (const label of ["a", "b"]) {
    log.push("before:" + label); const asleep = StaticSleeper.sleep(label, 1);
    pending[pending.length - 1]();
    await asleep; log.push("after:" + label);
  }
  assert.compareArray(log, ["before:a", "timer:a", "promise:a", "micro:a", "after:a", "before:b", "timer:b", "promise:b", "micro:b", "after:b"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
