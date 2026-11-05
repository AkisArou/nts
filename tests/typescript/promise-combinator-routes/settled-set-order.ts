/*---
description: "Set insertion order determines the resulting record order. Route: Map lookup"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Set insertion order determines the resulting record order. Route: Map lookup. Node prints settled-set-order:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = new Set<Item>([3, "x", null]);
  const store = new Map<string, Iterable<Item>>(); store.set("s", inputs); const found = store.get("s"); if (found === undefined) throw new Error("missing"); const routed = found;
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.compareArray(value.map(x => x.status === "fulfilled" ? x.value : undefined), [3, "x", null]);
  console.log("settled-set-order:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
