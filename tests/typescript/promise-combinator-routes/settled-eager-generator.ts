/*---
description: "Generator iteration finishes synchronously before the next statement. Route: Map lookup"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Generator iteration finishes synchronously before the next statement. Route: Map lookup. Node prints settled-eager-generator:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = []; function* stream(): Generator<Item> { log.push("first"); yield 1; log.push("second"); yield 2; }
  const inputs: Iterable<Item> = stream();
  const store = new Map<string, Iterable<Item>>(); store.set("s", inputs); const found = store.get("s"); if (found === undefined) throw new Error("missing"); const routed = found;
  const joined = Promise.allSettled(routed);
  assert.compareArray(log, ["first", "second"]);
  const value = await joined;
  assert.compareArray(log, ["first", "second"]); assert.sameValue(value.length, 2);
  console.log("settled-eager-generator:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
