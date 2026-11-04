/*---
description: "Control: A private callback field is read at timeout registration; replacing it later preserves each selected function and ordered argument triple."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-private-fields, ts-this]
flags: [async]
---*/
// Control: A private callback field is read at timeout registration; replacing it later preserves each selected function and ordered argument triple.
// Node prints: sync|first:a:3:8|second:b:5:9|after
const log: string[] = [];
const pending: (() => void)[] = [];
class CallbackBox {
  #callback: (tag: string, first: number, second: number) => void = (tag, first, second) => { log.push("first:" + tag + ":" + first + ":" + second); };
  replace(prefix: string): void { this.#callback = (tag, first, second) => { log.push(prefix + ":" + tag + ":" + first + ":" + second); }; }
  start(tag: string, first: number, second: number): void { const callback = this.#callback; pending.push(() => callback(tag, first, second)); }
}
async function main(): Promise<void> {
  const box: CallbackBox = new CallbackBox();
  box.start("a", 3, 8); box.replace("second"); box.start("b", 5, 9); box.replace("late");
  log.push("sync");
  for (const callback of pending) callback();
  await Promise.resolve();
  log.push("after");
  assert.compareArray(log, ["sync", "first:a:3:8", "second:b:5:9", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
