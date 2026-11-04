/*---
description: "A readonly array supplies out-of-order delays to sequential sleeps; timer completion and queued work precede each loop continuation."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-readonly, ts-iteration]
flags: [async]
---*/
// Readonly delays route; awaiting in the loop keeps the input order despite the delay order. Node prints the checked log below, then Test262:AsyncTestComplete.
// before:9|promise:9|micro:9|timer:9|after:9|before:1|promise:1|micro:1|timer:1|after:1|before:4|promise:4|micro:4|timer:4|after:4
const log: string[] = [];
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(() => { log.push("timer:" + ms); resolve(); }, ms); });
}
async function main(): Promise<void> {
  const delays: readonly number[] = [9, 1, 4];
  for (const ms of delays) {
    log.push("before:" + ms);
    const asleep = sleep(ms);
    const ahead = Promise.resolve().then(() => { log.push("promise:" + ms); });
    queueMicrotask(() => { log.push("micro:" + ms); });
    await asleep;
    log.push("after:" + ms);
    await ahead;
  }
  assert.compareArray(log, ["before:9", "promise:9", "micro:9", "timer:9", "after:9", "before:1", "promise:1", "micro:1", "timer:1", "after:1", "before:4", "promise:4", "micro:4", "timer:4", "after:4"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
