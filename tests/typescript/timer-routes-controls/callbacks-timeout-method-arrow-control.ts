/*---
description: "Control: Public class methods reached through timeout arrows receive ordered arguments on two distinct receivers."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// Control: Public class methods reached through timeout arrows receive ordered arguments on two distinct receivers.
// Node prints: sync|left:13:a|right:96:b|left:18:c|after
const log: string[] = [];
const pending: (() => void)[] = [];
class CallbackReceiver {
  prefix: string; offset: number;
  constructor(prefix: string, offset: number) { this.prefix = prefix; this.offset = offset; }
  write(value: number, tag: string): void { log.push(this.prefix + ":" + (value + this.offset) + ":" + tag); }
  start(value: number, tag: string): void {
    const callback: (item: number, label: string) => void = (item, label) => this.write(item, label);
    pending.push(() => callback(value, tag));
  }
}
async function main(): Promise<void> {
  const first = new CallbackReceiver("left", 10), second = new CallbackReceiver("right", 100);
  first.start(3, "a"); second.start(-4, "b"); first.start(8, "c");
  log.push("sync");
  for (const callback of pending) callback();
  await Promise.resolve();
  log.push("after");
  assert.compareArray(log, ["sync", "left:13:a", "right:96:b", "left:18:c", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
