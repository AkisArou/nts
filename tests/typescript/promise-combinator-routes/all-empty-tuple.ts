/*---
description: "all of an empty iterable resolves with an empty array; route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all of an empty iterable resolves with an empty array. Route: readonly tuple row. Node prints all-empty-tuple:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Entry> = [];
  const rows: readonly [string, Iterable<Entry>][] = [["chosen", inputs]];
  const routed = rows[0][1];
  const joined = Promise.all(routed);
  const value = await joined;
  assert.compareArray(value, []);
  assert.sameValue(value.length, 0);
  console.log("all-empty-tuple:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
