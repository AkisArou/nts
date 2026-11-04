/*---
description: "Control: Generic number and string timer promises complete with the string first; Promise.any preserves that first fulfillment and the longer losing value."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-generics]
flags: [async]
---*/
// Generic two-type route; any returns the shorter string timer even when the number promise is its first input. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:text|any:中|timer:number|after
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
function later<T>(label: string, value: T, ms: number): Promise<T> {
  return new Promise<T>((resolve) => {
    const callback: () => void = () => { log.push("timer:" + label); resolve(value); };
    enqueue(callback, ms);
  });
}
async function main(): Promise<void> {
  const number = later<number>("number", 7, 20), text = later<string>("text", "中", 1);
  const joined = Promise.any([number, text]).then((value) => { log.push("any:" + value); return value; });
  log.push("sync");
  pending[1]();
  const winner = await joined;
  const remaining = Promise.all([number, text]);
  pending[0]();
  const values = await remaining; log.push("after");
  assert.sameValue(winner, "中"); assert.compareArray(values, [7, "中"]);
  assert.compareArray(log, ["sync", "timer:text", "any:中", "timer:number", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
