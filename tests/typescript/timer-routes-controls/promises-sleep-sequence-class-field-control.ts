/*---
description: "Control: Sequential sleeps dispatch the callback stored in one class field at each registration, preserving each label before the next sleep starts."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// Public callback field route; the two timer promises resume in the explicit await order. Node prints the checked log below, then Test262:AsyncTestComplete.
// before:first|timer:first|after:first|before:second|timer:second|after:second
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
class FieldSleeper {
  callback: () => void = () => {};
  sleep(label: string, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.callback = () => { log.push("timer:" + label); resolve(); };
      enqueue(this.callback, ms);
    });
  }
}
async function main(): Promise<void> {
  const route = new FieldSleeper();
  log.push("before:first"); const first = route.sleep("first", 12);
  pending[0]();
  await first; log.push("after:first");
  log.push("before:second"); const second = route.sleep("second", 1);
  pending[1]();
  await second; log.push("after:second");
  assert.compareArray(log, ["before:first", "timer:first", "after:first", "before:second", "timer:second", "after:second"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
