/*---
description: "Control: A discriminated callback union registers number then string fulfillments at equal delay; Promise.any selects the number even when the input promises are reversed."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-type-aliases, ts-unions, ts-discriminated-unions]
flags: [async]
---*/
// Narrowed callback route; any follows equal-delay timer creation order and retains both branch values. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:number:7|any:7|timer:text:中|after
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
type FulfillmentJob = { kind: "number"; value: number; callback: (value: number) => void } | { kind: "text"; value: string; callback: (value: string) => void };
function schedule(job: FulfillmentJob): void {
  if (job.kind === "number") enqueue(() => { log.push("timer:number:" + job.value); job.callback(job.value); }, 1);
  else enqueue(() => { log.push("timer:text:" + job.value); job.callback(job.value); }, 1);
}
async function main(): Promise<void> {
  const number = new Promise<number>((resolve) => { schedule({ kind: "number", value: 7, callback: resolve }); });
  const text = new Promise<string>((resolve) => { schedule({ kind: "text", value: "中", callback: resolve }); });
  const joined = Promise.any([text, number]).then((value) => { log.push("any:" + value); return value; });
  log.push("sync");
  pending[0]();
  const winner = await joined;
  const remaining = Promise.all([number, text]);
  pending[1]();
  const values = await remaining; log.push("after");
  assert.sameValue(winner, 7); assert.compareArray(values, [7, "中"]);
  assert.compareArray(log, ["sync", "timer:number:7", "any:7", "timer:text:中", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
