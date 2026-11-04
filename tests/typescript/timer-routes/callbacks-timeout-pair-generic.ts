/*---
description: "Timeout extra-argument pairs cross a generic helper at number and string; both sinks retain argument position and value."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-generics]
flags: [async]
---*/
// Timeout extra-argument pairs cross a generic helper at number and string; both sinks retain argument position and value.
// Node prints: sync|number:3:8|string:左:右|after
const log: string[] = [];
function schedule<T>(first: T, second: T, sink: (first: T, second: T) => void): void {
  setTimeout(sink, 1, first, second);
}
async function main(): Promise<void> {
  schedule<number>(3, 8, (first, second) => { log.push("number:" + first + ":" + second); });
  schedule<string>("左", "右", (first, second) => { log.push("string:" + first + ":" + second); });
  log.push("sync");
  await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  log.push("after");
  assert.compareArray(log, ["sync", "number:3:8", "string:左:右", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
