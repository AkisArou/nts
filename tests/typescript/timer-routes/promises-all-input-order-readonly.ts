/*---
description: "Readonly delays schedule three timer promises out of delay order; Promise.all preserves all input positions and resumes only after every timer."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-readonly]
flags: [async]
---*/
// Readonly delay route; all retains input-indexed values despite the different callback order. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:1|timer:2|timer:0|all:0:10:20|after
const log: string[] = [];
async function main(): Promise<void> {
  const delays: readonly number[] = [9, 1, 4];
  const jobs = delays.map((ms, index) => new Promise<number>((resolve) => {
    setTimeout(() => { log.push("timer:" + index); resolve(index * 10); }, ms);
  }));
  const joined = Promise.all(jobs);
  log.push("sync");
  const values = await joined; log.push("all:" + values.join(":"));
  await Promise.allSettled(jobs); log.push("after");
  assert.compareArray(values, [0, 10, 20]);
  assert.compareArray(log, ["sync", "timer:1", "timer:2", "timer:0", "all:0:10:20", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
