/*---
description: "all reads Set inputs in insertion order; route: captured input closure (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all reads Set inputs in insertion order. Route: captured input closure. Node prints all-set-insertion-order:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
function localAll<T>(inputs: Iterable<T>): Promise<Awaited<T>[]> {
  return new Promise((resolve, reject) => {
    const values: Awaited<T>[] = [];
    let remaining = 1;
    let position = 0;
    for (const input of inputs) {
      const index = position++;
      remaining++;
      Promise.resolve(input).then(value => {
        values[index] = value;
        remaining--;
        if (remaining === 0) resolve(values);
      }, reject);
    }
    remaining--;
    if (remaining === 0) resolve(values);
  });
}
async function main(): Promise<void> {
  const inputs: Iterable<Entry> = new Set<Entry>(["z", 2, "a"]);
  let selected: Iterable<Entry> = inputs;
  const getSelected = (): Iterable<Entry> => selected;
  const routed = getSelected();
  const joined = localAll(routed);
  const value = await joined;
  assert.compareArray(value, ["z", 2, "a"]);
  console.log("all-set-insertion-order:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
