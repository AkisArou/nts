/*---
description: "all reads Set inputs in insertion order; route: captured input closure"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all reads Set inputs in insertion order. Route: captured input closure. Node prints all-set-insertion-order:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Entry> = new Set<Entry>(["z", 2, "a"]);
  let selected: Iterable<Entry> = inputs;
  const getSelected = (): Iterable<Entry> => selected;
  const routed = getSelected();
  const joined = Promise.all(routed);
  const value = await joined;
  assert.compareArray(value, ["z", 2, "a"]);
  console.log("all-set-insertion-order:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
