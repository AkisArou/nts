/*---
description: "Interval arrows select static add and subtract methods; repeated delivered arguments update the correct static totals."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-static]
flags: [async]
---*/
// Interval arrows select static add and subtract methods; repeated delivered arguments update the correct static totals.
// Node prints: add:sync|add:13:a|add:16:a|subtract:sync|subtract:96:b|subtract:92:b|after
const log: string[] = [];
class CallbackStatics {
  static sum: number = 10; static difference: number = 100;
  static add(value: number, tag: string): void { CallbackStatics.sum += value; log.push("add:" + CallbackStatics.sum + ":" + tag); }
  static subtract(value: number, tag: string): void { CallbackStatics.difference -= value; log.push("subtract:" + CallbackStatics.difference + ":" + tag); }
  static start(value: number, tag: string, sink: (value: number, tag: string) => void): Promise<void> {
    return new Promise<void>((resolve) => {
      let count = 0;
      const callback = (item: number, label: string): void => { sink(item, label); if (++count === 2) { clearInterval(handle); resolve(); } };
      const handle: number = setInterval(callback, 1, value, tag);
    });
  }
}
async function main(): Promise<void> {
  const first = CallbackStatics.start(3, "a", (value, tag) => CallbackStatics.add(value, tag)); log.push("add:sync");
  await first;
  const second = CallbackStatics.start(4, "b", (value, tag) => CallbackStatics.subtract(value, tag)); log.push("subtract:sync");
  await second;
  log.push("after");
  assert.compareArray(log, ["add:sync", "add:13:a", "add:16:a", "subtract:sync", "subtract:96:b", "subtract:92:b", "after"]);
  assert.sameValue(CallbackStatics.sum, 16); assert.sameValue(CallbackStatics.difference, 92);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
