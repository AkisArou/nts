/*---
description: "Tuple delays create the long promise first and the short promise second; Promise.all waits for the last timer and returns values in input order."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-tuples]
flags: [async]
---*/
// Tuple delay route; all must wait for the long callback before the consumer runs. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:fast|timer:slow|all:slow:fast|after
const log: string[] = [];
function later(value: string, ms: number): Promise<string> {
  return new Promise<string>((resolve) => { setTimeout(() => { log.push("timer:" + value); resolve(value); }, ms); });
}
async function main(): Promise<void> {
  const delays: [number, number] = [20, 1];
  const jobs: [Promise<string>, Promise<string>] = [later("slow", delays[0]), later("fast", delays[1])];
  const joined = Promise.all(jobs).then((values) => { log.push("all:" + values.join(":")); return values; });
  log.push("sync");
  const values = await joined;
  await Promise.allSettled(jobs); log.push("after");
  assert.compareArray(values, ["slow", "fast"]);
  assert.compareArray(log, ["sync", "timer:fast", "timer:slow", "all:slow:fast", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
