/*---
description: "Interval arguments cross a generic helper at object and array; each repeated callback sees the same reference and the preceding callback's write."
features: [ts-timer-routes, ts-timer-route-callbacks, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-generics, ts-objects]
flags: [async]
---*/
// Interval arguments cross a generic helper at object and array; each repeated callback sees the same reference and the preceding callback's write.
// Node prints: object:sync|object:true:2:payload|object:true:3:payload|array:sync|array:true:5:payload|array:true:7:payload|after
const log: string[] = [];
function repeat<T>(value: T, sink: (value: T, tag: string) => void): Promise<void> {
  return new Promise<void>((resolve) => {
    let count = 0;
    const tick = (item: T, tag: string): void => { sink(item, tag); if (++count === 2) { clearInterval(handle); resolve(); } };
    const handle: number = setInterval(tick, 1, value, "payload");
  });
}
async function main(): Promise<void> {
  const object: { value: number } = { value: 2 }, array: number[] = [5];
  const first = repeat<{ value: number }>(object, (value, tag) => { log.push("object:" + (value === object) + ":" + value.value + ":" + tag); value.value++; });
  log.push("object:sync");
  await first;
  const second = repeat<number[]>(array, (value, tag) => { log.push("array:" + (value === array) + ":" + value[0] + ":" + tag); value[0] += 2; });
  log.push("array:sync");
  await second;
  log.push("after");
  assert.compareArray(log, ["object:sync", "object:true:2:payload", "object:true:3:payload", "array:sync", "array:true:5:payload", "array:true:7:payload", "after"]);
  assert.sameValue(object.value, 4); assert.sameValue(array[0], 9);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
