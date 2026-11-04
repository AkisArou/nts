/*---
description: "Control: Each typed for-let index is captured by its own timeout callback; a delivered tag is paired with that step's index after the loop finishes."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown]
flags: [async]
---*/
// Control: Each typed for-let index is captured by its own timeout callback; a delivered tag is paired with that step's index after the loop finishes.
// Node prints: sync|step:0|step:1|step:2|after
const log: string[] = [];
const pending: (() => void)[] = [];
async function main(): Promise<void> {
  for (let index: number = 0; index < 3; index++) {
    const callback: (tag: string) => void = (tag) => { log.push(tag + ":" + index); };
    pending.push(() => callback("step"));
  }
  log.push("sync");
  for (const callback of pending) callback();
  await Promise.resolve();
  log.push("after");
  assert.compareArray(log, ["sync", "step:0", "step:1", "step:2", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
