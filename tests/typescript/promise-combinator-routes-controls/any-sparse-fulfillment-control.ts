/*---
description: "Any fulfills with undefined from a hole in a numeric array. Route: constrained generic helper (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// Any fulfills with undefined from a hole in a numeric array. Route: constrained generic helper. Node prints any-sparse-fulfillment:ok.
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
async function main(): Promise<void> {
  const inputs: Iterable<Item> = new Array<number>(2);
  function pass<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = pass<Item>(inputs);
  const result = localAny(routed);
  const value = await result;
  assert.sameValue(value, undefined);
  console.log("any-sparse-fulfillment:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
