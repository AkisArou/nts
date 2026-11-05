/*---
description: "The earlier position wins among already fulfilled promises. Route: Map lookup"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// The earlier position wins among already fulfilled promises. Route: Map lookup. Node prints race-two-resolved:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [Promise.resolve("a"), Promise.resolve("b")];
  const map = new Map<string, Iterable<Item>>(); map.set("x", inputs); const found = map.get("x"); if (found === undefined) throw new Error("missing"); const routed = found;
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, "a");
  console.log("race-two-resolved:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
