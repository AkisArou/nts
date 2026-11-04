/*---
description: "Control: Tuple delays place a short rejection before a long fulfillment; Promise.allSettled waits for both and preserves input-position statuses, value and Error identity."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-tuples]
flags: [async]
---*/
// Tuple delay route; allSettled collects mixed outcomes in input order after the last timer. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|reject:short|resolve:7|settled:fulfilled:rejected|after
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
async function main(): Promise<void> {
  const delays: [number, number] = [20, 1], fault = new Error("short");
  const first = new Promise<number>((resolve) => { enqueue(() => { log.push("resolve:7"); resolve(7); }, delays[0]); });
  const second = new Promise<string>((resolve, reject) => { enqueue(() => { log.push("reject:short"); reject(fault); }, delays[1]); });
  const joined = Promise.allSettled([first, second]);
  log.push("sync");
  pending[1](); pending[0]();
  const results = await joined;
  const statuses = results.map((item) => item.status);
  const values: unknown[] = results.map((item) => item.status === "fulfilled" ? item.value : item.reason);
  log.push("settled:" + statuses.join(":"), "after");
  assert.compareArray(statuses, ["fulfilled", "rejected"]); assert.compareArray(values, [7, fault]);
  assert.compareArray(log, ["sync", "reject:short", "resolve:7", "settled:fulfilled:rejected", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
