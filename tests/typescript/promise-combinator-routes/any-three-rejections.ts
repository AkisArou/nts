/*---
description: "AggregateError contains three original reasons in input order. Route: Map lookup"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// AggregateError contains three original reasons in input order. Route: Map lookup. Node prints any-three-rejections:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const a = { id: 1 }, b = { id: 2 }, c = { id: 3 };
  const inputs: Iterable<Item> = [Promise.reject(a), Promise.reject(b), Promise.reject(c)];
  const map = new Map<string, Iterable<Item>>(); map.set("x", inputs); const found = map.get("x"); if (found === undefined) throw new Error("missing"); const routed = found;
  const result = Promise.any(routed);
  let caught: unknown; try { await result; } catch (error: unknown) { caught = error; }
  if (!(caught instanceof AggregateError)) throw new Error("expected AggregateError");
  assert.sameValue(caught.constructor, AggregateError); assert.sameValue(caught instanceof Error, true);
  assert.sameValue("errors" in caught, true); assert.compareArray(caught.errors, [a,b,c]);
  console.log("any-three-rejections:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
