/*---
description: "Two timeout callbacks share one mutable let within each loop step; delivered increments affect that step's reader without changing another step."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown]
flags: [async]
---*/
// Two timeout callbacks share one mutable let within each loop step; delivered increments affect that step's reader without changing another step.
// Node prints: sync|write:0:5|read:0:5|write:1:15|read:1:15|write:2:25|read:2:25|after
const log: string[] = [];
async function main(): Promise<void> {
  for (let index: number = 0; index < 3; index++) {
    let value: number = index * 10;
    const writer: (amount: number) => void = (amount) => { value += amount; log.push("write:" + index + ":" + value); };
    const reader: (tag: string) => void = (tag) => { log.push(tag + ":" + index + ":" + value); };
    setTimeout(writer, 1, 5); setTimeout(reader, 1, "read");
  }
  log.push("sync");
  await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  log.push("after");
  assert.compareArray(log, ["sync", "write:0:5", "read:0:5", "write:1:15", "read:1:15", "write:2:25", "read:2:25", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
