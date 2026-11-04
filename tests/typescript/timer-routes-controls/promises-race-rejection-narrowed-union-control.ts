/*---
description: "Control: A narrowed number-or-error callback union resolves the longer timer and rejects the shorter; Promise.race preserves the exact shorter rejection."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-type-aliases, ts-unions, ts-discriminated-unions]
flags: [async]
---*/
// Discriminated callback route; a shorter rejection beats the longer fulfillment without dropping its value. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:error|race:rejected|timer:number|after
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
type RaceJob = { kind: "number"; value: number; callback: (value: number) => void } | { kind: "error"; value: Error; callback: (value: Error) => void };
function schedule(job: RaceJob, ms: number): void {
  if (job.kind === "number") enqueue(() => { log.push("timer:number"); job.callback(job.value); }, ms);
  else enqueue(() => { log.push("timer:error"); job.callback(job.value); }, ms);
}
async function main(): Promise<void> {
  const fault = new Error("short timer");
  const slow = new Promise<number>((resolve) => { schedule({ kind: "number", value: 7, callback: resolve }, 20); });
  const fast = new Promise<number>((resolve, reject) => { schedule({ kind: "error", value: fault, callback: reject }, 1); });
  let observed: unknown;
  const raced = Promise.race([slow, fast]).then((value) => { log.push("race:value:" + value); }, (error: unknown) => { observed = error; log.push("race:rejected"); });
  log.push("sync");
  pending[1]();
  await raced;
  const remaining = Promise.allSettled([slow, fast]);
  pending[0]();
  await remaining; const value = await slow; log.push("after");
  assert.sameValue(observed, fault); assert.sameValue(value, 7);
  assert.compareArray(log, ["sync", "timer:error", "race:rejected", "timer:number", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
