/*---
description: "all returns results in input order although later inputs settle first; route: interface input field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all returns results in input order although later inputs settle first. Route: interface input field. Node prints all-order-delayed-interface:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
function later(value: Data, turns: number): Promise<Data> {
  let chain = Promise.resolve();
  for (let i = 0; i < turns; i++) chain = chain.then(() => undefined);
  return chain.then(() => value);
}
async function main(): Promise<void> {
  const inputs: Iterable<Entry> = [later("slow", 3), later("fast", 1), "now"];
  interface Holder { readonly items: Iterable<Entry>; }
  const owner: Holder = { items: inputs };
  const routed = owner.items;
  const joined = Promise.all(routed);
  const value = await joined;
  assert.compareArray(value, ["slow", "fast", "now"]);
  console.log("all-order-delayed-interface:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
