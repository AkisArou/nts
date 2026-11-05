/*---
description: "All rejections yield fulfilled results in input order. Route: Map lookup"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// All rejections yield fulfilled results in input order. Route: Map lookup. Node prints settled-all-rejected:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const a = { id: 1 }, b = { id: 2 };
  const inputs: Iterable<Item> = [Promise.reject(a), Promise.reject(b)];
  const store = new Map<string, Iterable<Item>>(); store.set("s", inputs); const found = store.get("s"); if (found === undefined) throw new Error("missing"); const routed = found;
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.compareArray(value.map(x => x.status), ["rejected", "rejected"]); if (value[0].status === "rejected" && value[1].status === "rejected") { assert.sameValue(value[0].reason, a); assert.sameValue(value[1].reason, b); }
  console.log("settled-all-rejected:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
