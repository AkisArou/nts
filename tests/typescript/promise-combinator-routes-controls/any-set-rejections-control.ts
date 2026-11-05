/*---
description: "A Set's rejected members appear in insertion order in errors. Route: static class field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// A Set's rejected members appear in insertion order in errors. Route: static class field. Node prints any-set-rejections:ok.
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
  const inputs: Iterable<Item> = new Set<Item>([Promise.reject("a"), Promise.reject("b")]);
  class Holder { static xs: Iterable<Item>; } Holder.xs = inputs; const routed = Holder.xs;
  const result = localAny(routed);
  let caught: unknown; try { await result; } catch (error: unknown) { caught = error; }
  if (!(caught instanceof AggregateError)) throw new Error("expected AggregateError");
  assert.sameValue(caught.constructor, AggregateError); assert.sameValue(caught instanceof Error, true);
  assert.sameValue("errors" in caught, true); assert.compareArray(caught.errors, ["a","b"]);
  console.log("any-set-rejections:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
