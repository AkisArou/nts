/*---
description: "A rejection before a later fulfillment does not reject any. Route: constrained generic helper (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// A rejection before a later fulfillment does not reject any. Route: constrained generic helper. Node prints any-after-first-rejection:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localAny<T>(inputs: Iterable<T>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    let count = 1, index = 0;
    const errors: unknown[] = [];
    for (const input of inputs) {
      const position = index++; count++;
      Promise.resolve(input).then(resolve, (reason: unknown) => {
        errors[position] = reason;
        if (--count === 0) reject(new AggregateError(errors));
      });
    }
    if (--count === 0) reject(new AggregateError(errors));
  });
}
function delayed(value: Value, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => value); }
async function main(): Promise<void> {
  const reason = { id: 1 };
  const inputs: Iterable<Item> = [Promise.reject(reason), delayed("yes", 2)];
  function pass<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = pass<Item>(inputs);
  const result = localAny(routed);
  const value = await result;
  assert.sameValue(value, "yes");
  console.log("any-after-first-rejection:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
