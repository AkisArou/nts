/*---
description: "Control: A static callback field registers three equal-delay outcomes; Promise.allSettled preserves a separately permuted input order and every distinct payload."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-class, ts-class-fields, ts-static]
flags: [async]
---*/
// Static callback field route; allSettled keeps each registered callback and the combinator input positions. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|timer:first|timer:second|timer:third|settled:rejected:rejected:fulfilled|after
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
class StaticSettlement {
  static callback: () => void = () => {};
  static later(label: string, value: number, fail: boolean): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      StaticSettlement.callback = () => { log.push("timer:" + label); if (fail) reject(value); else resolve(value); };
      enqueue(StaticSettlement.callback, 1);
    });
  }
}
async function main(): Promise<void> {
  const first = StaticSettlement.later("first", 17, true), second = StaticSettlement.later("second", 9, false), third = StaticSettlement.later("third", 23, true);
  const joined = Promise.allSettled([third, first, second]);
  log.push("sync");
  pending[0](); pending[1](); pending[2]();
  const results = await joined;
  const statuses = results.map((item) => item.status);
  const values: unknown[] = results.map((item) => item.status === "fulfilled" ? item.value : item.reason);
  log.push("settled:" + statuses.join(":"), "after");
  assert.compareArray(statuses, ["rejected", "rejected", "fulfilled"]); assert.compareArray(values, [23, 17, 9]);
  assert.compareArray(log, ["sync", "timer:first", "timer:second", "timer:third", "settled:rejected:rejected:fulfilled", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
