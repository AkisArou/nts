/*---
description: "Generic number and string timer promises are created together with the longer first; Promise.race chooses the shorter string and preserves both values after draining."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-generics]
flags: [async]
---*/
// Generic two-type route; race settles before the longer losing timer, which is still awaited. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:fast|race:中|timer:slow|after
const log: string[] = [];
function later<T>(label: string, value: T, ms: number): Promise<T> {
  return new Promise<T>((resolve) => {
    const callback: () => void = () => { log.push("timer:" + label); resolve(value); };
    setTimeout(callback, ms);
  });
}
async function main(): Promise<void> {
  const slow = later<number>("slow", 7, 20), fast = later<string>("fast", "中", 1);
  const raced = Promise.race([slow, fast]).then((value) => { log.push("race:" + value); return value; });
  log.push("sync");
  const winner = await raced;
  const remaining = Promise.all([slow, fast]);
  const values = await remaining; log.push("after");
  assert.sameValue(winner, "中"); assert.compareArray(values, [7, "中"]);
  assert.compareArray(log, ["sync", "timer:fast", "race:中", "timer:slow", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
