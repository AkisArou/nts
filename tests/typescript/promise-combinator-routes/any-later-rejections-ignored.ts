/*---
description: "A losing rejected promise does not change the fulfilled result. Route: static class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// A losing rejected promise does not change the fulfilled result. Route: static class field. Node prints any-later-rejections-ignored:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [4, Promise.reject(new Error("loser"))];
  class Holder { static xs: Iterable<Item>; } Holder.xs = inputs; const routed = Holder.xs;
  const result = Promise.any(routed);
  const value = await result;
  assert.sameValue(value, 4);
  console.log("any-later-rejections-ignored:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
