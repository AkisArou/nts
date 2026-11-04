/*---
description: "Control: Tuple delays create a long fulfillment, a short rejection and a middle fulfillment together; Promise.any ignores the rejection and settles with the first fulfillment."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-tuples]
flags: [async]
---*/
// Tuple delay route; any skips the early rejection and settles before the final losing timer. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|reject:short|timer:middle|any:middle|timer:long|after
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
async function main(): Promise<void> {
  const delays: [number, number, number] = [20, 1, 8], fault = new Error("short");
  const long = new Promise<string>((resolve) => { enqueue(() => { log.push("timer:long"); resolve("long"); }, delays[0]); });
  const short = new Promise<string>((resolve, reject) => { enqueue(() => { log.push("reject:short"); reject(fault); }, delays[1]); });
  const middle = new Promise<string>((resolve) => { enqueue(() => { log.push("timer:middle"); resolve("middle"); }, delays[2]); });
  const joined = Promise.any([long, short, middle]).then((value) => { log.push("any:" + value); return value; });
  log.push("sync");
  pending[1](); pending[2]();
  const winner = await joined;
  const remaining = Promise.allSettled([long, short, middle]);
  pending[0]();
  const results = await remaining; log.push("after");
  const statuses = results.map((item) => item.status);
  const values: unknown[] = results.map((item) => item.status === "fulfilled" ? item.value : item.reason);
  assert.sameValue(winner, "middle"); assert.compareArray(statuses, ["fulfilled", "rejected", "fulfilled"]); assert.compareArray(values, ["long", fault, "middle"]);
  assert.compareArray(log, ["sync", "reject:short", "timer:middle", "any:middle", "timer:long", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
