/*---
description: "A losing rejected promise does not change the fulfilled result. Route: static class field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// A losing rejected promise does not change the fulfilled result. Route: static class field. Node prints any-later-rejections-ignored:ok.
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
  const inputs: Iterable<Item> = [4, Promise.reject(new Error("loser"))];
  class Holder { static xs: Iterable<Item>; } Holder.xs = inputs; const routed = Holder.xs;
  const result = localAny(routed);
  const value = await result;
  assert.sameValue(value, 4);
  console.log("any-later-rejections-ignored:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
