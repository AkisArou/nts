/*---
description: "A Set's rejected members appear in insertion order in errors. Route: static class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// A Set's rejected members appear in insertion order in errors. Route: static class field. Node prints any-set-rejections:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = new Set<Item>([Promise.reject("a"), Promise.reject("b")]);
  class Holder { static xs: Iterable<Item>; } Holder.xs = inputs; const routed = Holder.xs;
  const result = Promise.any(routed);
  let caught: unknown; try { await result; } catch (error: unknown) { caught = error; }
  if (!(caught instanceof AggregateError)) throw new Error("expected AggregateError");
  assert.sameValue(caught.constructor, AggregateError); assert.sameValue(caught instanceof Error, true);
  assert.sameValue("errors" in caught, true); assert.compareArray(caught.errors, ["a","b"]);
  console.log("any-set-rejections:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
