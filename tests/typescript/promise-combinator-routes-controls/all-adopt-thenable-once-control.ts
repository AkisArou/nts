/*---
description: "all adopts a typed thenable and calls its then method once; route: discriminated union (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all adopts a typed thenable and calls its then method once. Route: discriminated union. Node prints all-adopt-thenable-once:ok.
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
  let calls = 0;
  const thenable: Thenable = { then(resolve, reject): void { calls++; resolve(7); } };
  const inputs: Iterable<Entry> = [thenable, 3];
  type Selection = { kind: "chosen"; items: Iterable<Entry> } | { kind: "other"; items: Iterable<Entry> };
  const selected: Selection = { kind: "chosen", items: inputs };
  const routed = selected.items;
  const joined = localAll(routed);
  const value = await joined;
  assert.compareArray(value, [7, 3]);
  assert.sameValue(calls, 1);
  console.log("all-adopt-thenable-once:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
