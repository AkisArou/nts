/*---
description: "Control: Public class methods reached through interval arrows retain both extra arguments and each receiver's changing state."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// Control: Public class methods reached through interval arrows retain both extra arguments and each receiver's changing state.
// Node prints: left:sync|left:13:a|left:16:a|right:sync|right:96:b|right:92:b|after
const log: string[] = [];
const pending: (() => void)[] = [];
function keep(callback: () => void): number { pending.push(callback); return 0; }
function forget(handle: number | undefined): void {}
class CallbackReceiver {
  prefix: string; total: number;
  constructor(prefix: string, total: number) { this.prefix = prefix; this.total = total; }
  write(value: number, tag: string): void { this.total += value; log.push(this.prefix + ":" + this.total + ":" + tag); }
  start(value: number, tag: string): Promise<void> {
    return new Promise<void>((resolve) => {
      let count = 0;
      const callback = (item: number, label: string): void => { this.write(item, label); if (++count === 2) { forget(handle); resolve(); } };
      const handle: number = keep(() => callback(value, tag));
    });
  }
}
async function main(): Promise<void> {
  const left = new CallbackReceiver("left", 10), right = new CallbackReceiver("right", 100);
  const first = left.start(3, "a"); log.push("left:sync");
  pending[0](); pending[0]();
  await first;
  const second = right.start(-4, "b"); log.push("right:sync");
  pending[1](); pending[1]();
  await second;
  log.push("after");
  assert.compareArray(log, ["left:sync", "left:13:a", "left:16:a", "right:sync", "right:96:b", "right:92:b", "after"]);
  assert.sameValue(left.total, 16); assert.sameValue(right.total, 92);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
