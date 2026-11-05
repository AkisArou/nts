/*---
description: "two registered then callbacks on one all result see the same array; route: static class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// two registered then callbacks on one all result see the same array. Route: static class field. Node prints all-shared-result-reactions-field:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Entry> = [8, Promise.resolve(9)];
  class StaticHolder { static items: Iterable<Entry>; }
  StaticHolder.items = inputs;
  const routed = StaticHolder.items;
  const joined = Promise.all(routed);
  let first: unknown;
  let second: unknown;
  joined.then(items => { first = items; });
  joined.then(items => { second = items; });
  const value = await joined;
  assert.compareArray(value, [8, 9]);
  assert.sameValue(first, value);
  assert.sameValue(second, value);
  console.log("all-shared-result-reactions-field:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
