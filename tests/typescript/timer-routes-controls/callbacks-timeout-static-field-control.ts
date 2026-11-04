/*---
description: "Control: A static callback field is replaced between timeout registrations; each saved target retains its three supplied argument values."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-static]
flags: [async]
---*/
// Control: A static callback field is replaced between timeout registrations; each saved target retains its three supplied argument values.
// Node prints: sync|first:a:3:8|second:b:5:9|after
const log: string[] = [];
const pending: (() => void)[] = [];
class CallbackBox {
  static callback: (tag: string, first: number, second: number) => void = (tag, first, second) => { log.push("first:" + tag + ":" + first + ":" + second); };
}
async function main(): Promise<void> {
  const first = CallbackBox.callback; pending.push(() => first("a", 3, 8));
  CallbackBox.callback = (tag, first, second) => { log.push("second:" + tag + ":" + first + ":" + second); };
  const second = CallbackBox.callback; pending.push(() => second("b", 5, 9));
  CallbackBox.callback = (tag, first, second) => { log.push("late:" + tag + ":" + first + ":" + second); };
  log.push("sync");
  for (const callback of pending) callback();
  await Promise.resolve();
  log.push("after");
  assert.compareArray(log, ["sync", "first:a:3:8", "second:b:5:9", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
