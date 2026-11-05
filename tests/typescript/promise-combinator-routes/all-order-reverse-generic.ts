/*---
description: "all keeps input order across three reverse settlement times; route: generic typed forwarding helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all keeps input order across three reverse settlement times. Route: generic typed forwarding helper. Node prints all-order-reverse-generic:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
function later(value: Data, turns: number): Promise<Data> {
  let chain = Promise.resolve();
  for (let i = 0; i < turns; i++) chain = chain.then(() => undefined);
  return chain.then(() => value);
}
async function main(): Promise<void> {
  const inputs: Iterable<Entry> = [later("third", 4), later("first", 0), later("second", 2)];
  function forward<T extends Entry>(source: Iterable<T>): Iterable<T> { return source; }
  const routed = forward<Entry>(inputs);
  const joined = Promise.all(routed);
  const value = await joined;
  assert.compareArray(value, ["third", "first", "second"]);
  console.log("all-order-reverse-generic:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
