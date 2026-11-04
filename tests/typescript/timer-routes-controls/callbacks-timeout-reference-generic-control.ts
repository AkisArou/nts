/*---
description: "Control: Four timeout arguments cross a generic helper at object and array; reference identity and pre-callback writes survive beside ordered scalar arguments."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-generics, ts-objects]
flags: [async]
---*/
// Control: Four timeout arguments cross a generic helper at object and array; reference identity and pre-callback writes survive beside ordered scalar arguments.
// Node prints: sync|object:true:17:tail:6:false|array:true:23:tail:6:false|after
const log: string[] = [];
const pending: (() => void)[] = [];
function schedule<T>(value: T, sink: (value: T, tag: string, count: number, flag: boolean) => void): void {
  pending.push(() => sink(value, "tail", 6, false));
}
async function main(): Promise<void> {
  const object: { value: number } = { value: 2 }, array: number[] = [3];
  schedule<{ value: number }>(object, (value, tag, count, flag) => { log.push("object:" + (value === object) + ":" + value.value + ":" + tag + ":" + count + ":" + flag); });
  schedule<number[]>(array, (value, tag, count, flag) => { log.push("array:" + (value === array) + ":" + value[0] + ":" + tag + ":" + count + ":" + flag); });
  object.value = 17; array[0] = 23;
  log.push("sync");
  for (const callback of pending) callback();
  await Promise.resolve();
  log.push("after");
  assert.compareArray(log, ["sync", "object:true:17:tail:6:false", "array:true:23:tail:6:false", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
