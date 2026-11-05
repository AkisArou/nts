/*---
description: "First fulfillment wins by time rather than input index. Route: interface field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// First fulfillment wins by time rather than input index. Route: interface field. Node prints any-first-fulfilled-later:ok.
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
  const inputs: Iterable<Item> = [delayed("slow", 3), delayed("fast", 1)];
  interface Bag { xs: Iterable<Item>; } const bag: Bag = { xs: inputs }; const routed = bag.xs;
  const result = localAny(routed);
  const value = await result;
  assert.sameValue(value, "fast");
  console.log("any-first-fulfilled-later:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
