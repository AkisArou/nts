/*---
description: "A timer promise reaction narrows both number and string callback jobs before scheduling children; the waiting same-delay peer stays first and both branch values reach their promises."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-type-aliases, ts-unions, ts-discriminated-unions]
flags: [async]
---*/
// Discriminated callback route; reaction-created timers keep their selected callback and wait behind the peer. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:parent|reaction|timer:peer|timer:number:7|timer:text:中|after
const log: string[] = [];
type FulfillmentJob = { kind: "number"; value: number; callback: (value: number) => void } | { kind: "text"; value: string; callback: (value: string) => void };
function schedule(job: FulfillmentJob): void {
  if (job.kind === "number") setTimeout(() => { log.push("timer:number:" + job.value); job.callback(job.value); }, 1);
  else setTimeout(() => { log.push("timer:text:" + job.value); job.callback(job.value); }, 1);
}
function wake(label: string): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(() => { log.push("timer:" + label); resolve(); }, 1); });
}
async function main(): Promise<void> {
  const parent = wake("parent"), peer = wake("peer");
  const children = parent.then(() => {
    log.push("reaction");
    const number = new Promise<number>((resolve) => { schedule({ kind: "number", value: 7, callback: resolve }); });
    const text = new Promise<string>((resolve) => { schedule({ kind: "text", value: "中", callback: resolve }); });
    return Promise.all([number, text]);
  });
  const joined = Promise.all([peer, children]);
  log.push("sync");
  const values = await joined; log.push("after");
  assert.compareArray(values[1], [7, "中"]);
  assert.compareArray(log, ["sync", "timer:parent", "reaction", "timer:peer", "timer:number:7", "timer:text:中", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
