/*---
description: "Generic number and record timer promises complete in reverse order; Promise.all waits for both and preserves the number and original record identity."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-generics, ts-interfaces]
flags: [async]
---*/
// Generic two-type route; all preserves the exact numeric and record payloads through timer settlement. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:record|timer:number|all:7:中|after
const log: string[] = [];
interface TimerPayload { label: string; }
function later<T>(label: string, value: T, ms: number): Promise<T> {
  return new Promise<T>((resolve) => {
    const callback: () => void = () => { log.push("timer:" + label); resolve(value); };
    setTimeout(callback, ms);
  });
}
async function main(): Promise<void> {
  const record: TimerPayload = { label: "中" };
  const first = later<number>("number", 7, 20), second = later<TimerPayload>("record", record, 1);
  const joined = Promise.all([first, second]);
  log.push("sync");
  const values = await joined; log.push("all:" + values[0] + ":" + values[1].label);
  await Promise.allSettled([first, second]); log.push("after");
  assert.sameValue(values[0], 7); assert.sameValue(values[1], record); assert.sameValue(values[1].label, "中");
  assert.compareArray(log, ["sync", "timer:record", "timer:number", "all:7:中", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
