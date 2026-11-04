/*---
description: "A generic timeout receives its sink as an extra argument at number and string; the delivered function receives its matching value and tag."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-generics]
flags: [async]
---*/
// A generic timeout receives its sink as an extra argument at number and string; the delivered function receives its matching value and tag.
// Node prints: sync|number:12:argument|string:中:argument|after
const log: string[] = [];
function schedule<T>(value: T, sink: (value: T, tag: string) => void): void {
  const dispatch = (item: T, delivered: (item: T, tag: string) => void, tag: string): void => { delivered(item, tag); };
  setTimeout(dispatch, 1, value, sink, "argument");
}
async function main(): Promise<void> {
  schedule<number>(12, (value, tag) => { log.push("number:" + value + ":" + tag); });
  schedule<string>("中", (value, tag) => { log.push("string:" + value + ":" + tag); });
  log.push("sync");
  await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  log.push("after");
  assert.compareArray(log, ["sync", "number:12:argument", "string:中:argument", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
