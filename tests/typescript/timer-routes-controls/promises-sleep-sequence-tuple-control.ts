/*---
description: "Control: Sequential sleeps read a delay tuple; each await follows its same-delay witness and every promise and microtask queued ahead of the timers."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-tuples]
flags: [async]
---*/
// Tuple delay route; the direct resolver sleep resumes after its witness and queued work. Node prints the checked log below, then Test262:AsyncTestComplete.
// before:12|promise:12|micro:12|timer:12|after:12|before:1|promise:1|micro:1|timer:1|after:1
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
function sleep(ms: number): Promise<void> { return new Promise<void>((resolve) => { enqueue(resolve, ms); }); }
async function step(ms: number): Promise<void> {
  pending.length = 0;
  log.push("before:" + ms);
  const witness = new Promise<void>((resolve) => { enqueue(() => { log.push("timer:" + ms); resolve(); }, ms); });
  const asleep = sleep(ms);
  const ahead = new Promise<void>((resolve) => {
    Promise.resolve().then(() => { log.push("promise:" + ms); queueMicrotask(() => { log.push("micro:" + ms); resolve(); }); });
  });
  await ahead; pending[0](); pending[1]();
  await asleep;
  log.push("after:" + ms);
  await witness; await ahead;
}
async function main(): Promise<void> {
  const delays: [number, number] = [12, 1];
  await step(delays[0]); await step(delays[1]);
  assert.compareArray(log, ["before:12", "promise:12", "micro:12", "timer:12", "after:12", "before:1", "promise:1", "micro:1", "timer:1", "after:1"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
