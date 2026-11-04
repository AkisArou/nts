/*---
description: "Control: Private callback fields reject in reverse registration order; Promise.allSettled retains both rejection reasons in input order after all timers finish."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-class, ts-class-fields, ts-private-fields, ts-this]
flags: [async]
---*/
// Private callback field route; allSettled preserves an object reason and a string reason independently. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|reject:fast|reject:slow|settled:rejected:rejected|after
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, ms: number): void { pending.push(callback); }
class PrivateRejection {
  #callback: () => void = () => {};
  promise: Promise<never>;
  constructor(label: string, reason: unknown) {
    this.promise = new Promise<never>((resolve, reject) => { this.#callback = () => { log.push("reject:" + label); reject(reason); }; });
  }
  start(ms: number): void { enqueue(this.#callback, ms); }
}
async function main(): Promise<void> {
  const fault = { label: "slow" };
  const slow = new PrivateRejection("slow", fault), fast = new PrivateRejection("fast", "no");
  slow.start(20); fast.start(1);
  const joined = Promise.allSettled([slow.promise, fast.promise]); log.push("sync");
  pending[1](); pending[0]();
  const results = await joined;
  const statuses = results.map((item) => item.status);
  const reasons: unknown[] = results.map((item) => item.status === "rejected" ? item.reason : item.value);
  log.push("settled:" + statuses.join(":"), "after");
  assert.compareArray(statuses, ["rejected", "rejected"]); assert.compareArray(reasons, [fault, "no"]);
  assert.compareArray(log, ["sync", "reject:fast", "reject:slow", "settled:rejected:rejected", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
