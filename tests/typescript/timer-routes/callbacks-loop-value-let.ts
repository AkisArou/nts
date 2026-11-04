/*---
description: "Each for-of let value remains live in its own timeout callback; a write after registration changes only that step's value."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration]
flags: [async]
---*/
// Each for-of let value remains live in its own timeout callback; a write after registration changes only that step's value.
// Node prints: sync|step:a!|step:中!|step:!|after
const log: string[] = [];
async function main(): Promise<void> {
  const values: string[] = ["a", "中", ""];
  for (let value of values) {
    const callback: (tag: string) => void = (tag) => { log.push(tag + ":" + value); };
    setTimeout(callback, 1, "step");
    value += "!";
  }
  log.push("sync");
  await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  log.push("after");
  assert.compareArray(log, ["sync", "step:a!", "step:中!", "step:!", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
