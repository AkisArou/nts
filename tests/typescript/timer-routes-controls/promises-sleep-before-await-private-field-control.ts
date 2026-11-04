/*---
description: "Control: A private callback field queues a microtask and promise reaction before resolving each sleep; both jobs precede the awaiting continuation."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-iteration]
flags: [async]
---*/
// Private callback field route; queued callback-local jobs run before each await resumes. Node prints the checked log below, then Test262:AsyncTestComplete.
// before:first|timer:first|micro:first|promise:first|after:first|before:second|timer:second|micro:second|promise:second|after:second
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
class PrivateSleeper {
  #callback: () => void = () => {};
  sleep(label: string, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#callback = () => {
        log.push("timer:" + label);
        queueMicrotask(() => { log.push("micro:" + label); });
        Promise.resolve().then(() => { log.push("promise:" + label); });
        resolve();
      };
      enqueue(this.#callback, ms);
    });
  }
}
async function main(): Promise<void> {
  const route = new PrivateSleeper();
  for (const label of ["first", "second"]) {
    log.push("before:" + label); const asleep = route.sleep(label, 1);
    pending[pending.length - 1]();
    await asleep; log.push("after:" + label);
  }
  assert.compareArray(log, ["before:first", "timer:first", "micro:first", "promise:first", "after:first", "before:second", "timer:second", "micro:second", "promise:second", "after:second"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
