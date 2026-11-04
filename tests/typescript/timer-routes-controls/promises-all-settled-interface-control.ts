/*---
description: "Control: Two implementations of a promise-producing interface supply an immediate result and a timer result; Promise.allSettled preserves both values and waits for the timer."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-class, ts-interfaces]
flags: [async]
---*/
// Interface dispatch route; allSettled retains the distinct immediate and timer-backed implementation results. Node prints the checked log below, then Test262:AsyncTestComplete.
// direct:now|sync|timer:later|settled:fulfilled:fulfilled|after
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
interface TimerResultSource { run(label: string, ms: number): Promise<number>; }
class TimedResultSource implements TimerResultSource {
  run(label: string, ms: number): Promise<number> {
    return new Promise<number>((resolve) => { enqueue(() => { log.push("timer:" + label); resolve(7); }, ms); });
  }
}
class DirectResultSource implements TimerResultSource {
  run(label: string, ms: number): Promise<number> { log.push("direct:" + label); return Promise.resolve(-3); }
}
async function main(): Promise<void> {
  const routes: TimerResultSource[] = [new TimedResultSource(), new DirectResultSource()];
  const first = routes[0].run("later", 1), second = routes[1].run("now", 1);
  const joined = Promise.allSettled([first, second]);
  log.push("sync");
  pending[0]();
  const results = await joined;
  const statuses = results.map((item) => item.status);
  const values: unknown[] = results.map((item) => item.status === "fulfilled" ? item.value : item.reason);
  log.push("settled:" + statuses.join(":"), "after");
  assert.compareArray(statuses, ["fulfilled", "fulfilled"]); assert.compareArray(values, [7, -3]);
  assert.compareArray(log, ["direct:now", "sync", "timer:later", "settled:fulfilled:fulfilled", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
