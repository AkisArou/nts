/*---
description: "An earlier resolved promise wins against a later plain value. Route: readonly tuple row (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// An earlier resolved promise wins against a later plain value. Route: readonly tuple row. Node prints any-plain-second:ok.
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
  const inputs: Iterable<Item> = [Promise.resolve(2), 1];
  const rows: readonly [string, Iterable<Item>][] = [["x", inputs]]; const routed = rows[0][1];
  const result = localAny(routed);
  const value = await result;
  assert.sameValue(value, 2);
  console.log("any-plain-second:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
