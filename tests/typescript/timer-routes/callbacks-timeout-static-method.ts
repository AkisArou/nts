/*---
description: "Timeout arrows select two static methods and preserve their argument pairs; adding and subtracting produce distinct target witnesses."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-static]
flags: [async]
---*/
// Timeout arrows select two static methods and preserve their argument pairs; adding and subtracting produce distinct target witnesses.
// Node prints: sync|add:13:a|subtract:104:b|add:18:c|after
const log: string[] = [];
class CallbackStatics {
  static offset: number = 10;
  static add(value: number, tag: string): void { log.push("add:" + (CallbackStatics.offset + value) + ":" + tag); }
  static subtract(value: number, tag: string): void { log.push("subtract:" + (100 - value) + ":" + tag); }
  static startAdd(value: number, tag: string): void {
    const callback: (item: number, label: string) => void = (item, label) => CallbackStatics.add(item, label);
    setTimeout(callback, 1, value, tag);
  }
  static startSubtract(value: number, tag: string): void {
    const callback: (item: number, label: string) => void = (item, label) => CallbackStatics.subtract(item, label);
    setTimeout(callback, 1, value, tag);
  }
}
async function main(): Promise<void> {
  CallbackStatics.startAdd(3, "a"); CallbackStatics.startSubtract(-4, "b"); CallbackStatics.startAdd(8, "c");
  log.push("sync");
  await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  log.push("after");
  assert.compareArray(log, ["sync", "add:13:a", "subtract:104:b", "add:18:c", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
