/*---
description: "A first plain value wins over a later resolved promise. Route: Map lookup (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// A first plain value wins over a later resolved promise. Route: Map lookup. Node prints any-plain-first:ok.
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
  const inputs: Iterable<Item> = [1, Promise.resolve(2)];
  const map = new Map<string, Iterable<Item>>(); map.set("x", inputs); const found = map.get("x"); if (found === undefined) throw new Error("missing"); const routed = found;
  const result = localAny(routed);
  const value = await result;
  assert.sameValue(value, 1);
  console.log("any-plain-first:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
