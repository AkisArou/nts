/*---
description: "A class callback field is replaced between timeout registrations; each selected function receives its own three supplied arguments."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-class, ts-class-fields]
flags: [async]
---*/
// A class callback field is replaced between timeout registrations; each selected function receives its own three supplied arguments.
// Node prints: sync|first:a:3:8|second:b:5:9|after
const log: string[] = [];
class CallbackBox {
  callback: (tag: string, first: number, second: number) => void = (tag, first, second) => { log.push("first:" + tag + ":" + first + ":" + second); };
}
async function main(): Promise<void> {
  const box: CallbackBox = new CallbackBox();
  setTimeout(box.callback, 1, "a", 3, 8);
  box.callback = (tag, first, second) => { log.push("second:" + tag + ":" + first + ":" + second); };
  setTimeout(box.callback, 1, "b", 5, 9);
  box.callback = (tag, first, second) => { log.push("late:" + tag + ":" + first + ":" + second); };
  log.push("sync");
  await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  log.push("after");
  assert.compareArray(log, ["sync", "first:a:3:8", "second:b:5:9", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
