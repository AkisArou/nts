/*---
description: "Class-held callbacks resolve equal-delay promises in registration order; Promise.race chooses the first timer even with the input promises reversed."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// Class callback field route; timer creation order wins an equal-delay race over reversed inputs. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:first|race:first|timer:second|after
const log: string[] = [];
class RaceValue {
  callback: () => void = () => {};
  promise: Promise<string>;
  constructor(value: string) {
    this.promise = new Promise<string>((resolve) => { this.callback = () => { log.push("timer:" + value); resolve(value); }; });
  }
  start(): void { setTimeout(this.callback, 1); }
}
async function main(): Promise<void> {
  const first = new RaceValue("first"), second = new RaceValue("second");
  first.start(); second.start();
  const raced = Promise.race([second.promise, first.promise]).then((value) => { log.push("race:" + value); return value; });
  log.push("sync");
  const winner = await raced;
  const remaining = Promise.all([second.promise, first.promise]);
  const values = await remaining; log.push("after");
  assert.sameValue(winner, "first"); assert.compareArray(values, ["second", "first"]);
  assert.compareArray(log, ["sync", "timer:first", "race:first", "timer:second", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
