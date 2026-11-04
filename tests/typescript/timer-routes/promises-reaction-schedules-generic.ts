/*---
description: "A number timer promise reaction schedules number and string children through one generic helper; the waiting peer precedes both children and every resolved value survives."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-generics]
flags: [async]
---*/
// Generic two-type route; reaction-created children preserve creation order behind the existing timer. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:parent|reaction:7|timer:peer|timer:number|timer:text|after
const log: string[] = [];
function later<T>(label: string, value: T, ms: number): Promise<T> {
  return new Promise<T>((resolve) => {
    const callback: () => void = () => { log.push("timer:" + label); resolve(value); };
    setTimeout(callback, ms);
  });
}
async function main(): Promise<void> {
  const parent = later<number>("parent", 7, 1), peer = later<number>("peer", 9, 1);
  const children = parent.then((value) => {
    log.push("reaction:" + value);
    return Promise.all([later<number>("number", value + 1, 1), later<string>("text", "中", 1)]);
  });
  const joined = Promise.all([peer, children]);
  log.push("sync");
  const values = await joined; log.push("after");
  assert.sameValue(values[0], 9); assert.compareArray(values[1], [8, "中"]);
  assert.compareArray(log, ["sync", "timer:parent", "reaction:7", "timer:peer", "timer:number", "timer:text", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
