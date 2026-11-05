/*---
description: "A rejected thenable does not prevent another member's fulfillment. Route: Map lookup (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// A rejected thenable does not prevent another member's fulfillment. Route: Map lookup. Node prints any-thenable-reject-then-resolve:ok.
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
  const thenable: Thenable = { then(resolve, reject): void { reject("no"); } };
  const inputs: Iterable<Item> = [thenable, Promise.resolve(9)];
  const map = new Map<string, Iterable<Item>>(); map.set("x", inputs); const found = map.get("x"); if (found === undefined) throw new Error("missing"); const routed = found;
  const result = localAny(routed);
  const value = await result;
  assert.sameValue(value, 9);
  console.log("any-thenable-reject-then-resolve:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
