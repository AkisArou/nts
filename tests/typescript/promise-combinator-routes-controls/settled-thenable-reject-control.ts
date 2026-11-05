/*---
description: "A typed thenable rejection becomes a record. Route: interface field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// A typed thenable rejection becomes a record. Route: interface field. Node prints settled-thenable-reject:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localAllSettled<T>(items: Iterable<T>): Promise<PromiseSettledResult<Awaited<T>>[]> {
  return new Promise(resolve => {
    const records: PromiseSettledResult<Awaited<T>>[] = [];
    let count = 1, index = 0;
    for (const input of items) {
      const i = index++; count++;
      Promise.resolve(input).then(value => { records[i] = { status: "fulfilled", value }; if (--count === 0) resolve(records); },
        (reason: unknown) => { records[i] = { status: "rejected", reason }; if (--count === 0) resolve(records); });
    }
    if (--count === 0) resolve(records);
  });
}
async function main(): Promise<void> {
  const reason = { id: 7 }; const input: Thenable = { then(resolve, reject): void { reject(reason); } };
  const inputs: Iterable<Item> = [input];
  interface Source { entries: Iterable<Item>; } const source: Source = { entries: inputs }; const routed = source.entries;
  const joined = localAllSettled(routed);
  const value = await joined;
  assert.sameValue(value[0].status, "rejected"); if (value[0].status === "rejected") assert.sameValue(value[0].reason, reason);
  console.log("settled-thenable-reject:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
