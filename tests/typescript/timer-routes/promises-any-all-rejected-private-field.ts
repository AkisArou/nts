/*---
description: "Three private callback fields reject out of input order; Promise.any waits for the final rejection and aggregates the exact Error, string and negative-zero reasons in input order."
features: [ts-timer-routes, ts-timer-route-promises, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-errors, ts-narrowing, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly]
flags: [async]
---*/
// Private callback field route; any rejects only after every timer and preserves ordered rejection identities. Node prints the checked log below, then Test262:AsyncTestComplete.
// sync|reject:fast|reject:middle|reject:slow|any:rejected|after
const log: string[] = [];
class PrivateRejection {
  #callback: () => void = () => {};
  promise: Promise<never>;
  constructor(label: string, reason: unknown) {
    this.promise = new Promise<never>((resolve, reject) => { this.#callback = () => { log.push("reject:" + label); reject(reason); }; });
  }
  start(ms: number): void { setTimeout(this.#callback, ms); }
}
async function main(): Promise<void> {
  const fault = new Error("slow");
  const slow = new PrivateRejection("slow", fault), fast = new PrivateRejection("fast", "fast"), middle = new PrivateRejection("middle", -0);
  slow.start(20); fast.start(1); middle.start(8);
  const joined = Promise.any([slow.promise, fast.promise, middle.promise]); log.push("sync");
  let observed: unknown;
  try { await joined; log.push("unexpected fulfillment"); }
  catch (error: unknown) { observed = error; log.push("any:rejected"); }
  await Promise.allSettled([slow.promise, fast.promise, middle.promise]); log.push("after");
  if (!(observed instanceof AggregateError)) throw new Test262Error("expected AggregateError");
  const reasons: readonly unknown[] = observed.errors;
  assert.compareArray(reasons, [fault, "fast", -0]);
  assert.compareArray(log, ["sync", "reject:fast", "reject:middle", "reject:slow", "any:rejected", "after"]);
  console.log(log.join("|"));
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
