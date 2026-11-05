/*---
description: "all keeps the exact references of two plain and promised objects; route: Map.get of a declared iterable"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all keeps the exact references of two plain and promised objects. Route: Map.get of a declared iterable. Node prints all-object-identity-map:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
async function main(): Promise<void> {
  const left = { id: 2 };
  const right = { id: 3 };
  const inputs: Iterable<Entry> = [left, Promise.resolve(right)];
  const store = new Map<string, Iterable<Entry>>();
  store.set("chosen", inputs);
  const found = store.get("chosen");
  if (found === undefined) throw new Error("missing input");
  const routed = found;
  const joined = Promise.all(routed);
  const value = await joined;
  assert.sameValue(value[0], left);
  assert.sameValue(value[1], right);
  console.log("all-object-identity-map:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
