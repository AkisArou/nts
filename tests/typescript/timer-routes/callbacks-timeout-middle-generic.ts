/*---
description: "Three timeout arguments cross a generic helper at number and boolean; a string middle argument stays between distinct typed endpoints."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-generics]
flags: [async]
---*/
// Three timeout arguments cross a generic helper at number and boolean; a string middle argument stays between distinct typed endpoints.
// Node prints: sync|number:4:middle:9|boolean:false:middle:true|after
const log: string[] = [];
function schedule<T>(first: T, last: T, sink: (first: T, middle: string, last: T) => void): void {
  setTimeout(sink, 1, first, "middle", last);
}
async function main(): Promise<void> {
  schedule<number>(4, 9, (first, middle, last) => { log.push("number:" + first + ":" + middle + ":" + last); });
  schedule<boolean>(false, true, (first, middle, last) => { log.push("boolean:" + first + ":" + middle + ":" + last); });
  log.push("sync");
  await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  log.push("after");
  assert.compareArray(log, ["sync", "number:4:middle:9", "boolean:false:middle:true", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
