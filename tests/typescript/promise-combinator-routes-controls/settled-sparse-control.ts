/*---
description: "Holes in numeric arrays become fulfilled undefined records. Route: captured binding (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Holes in numeric arrays become fulfilled undefined records. Route: captured binding. Node prints settled-sparse:ok.
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
  const inputs: Iterable<Item> = new Array<number>(2);
  let captured = inputs; const read = (): Iterable<Item> => captured; const routed = read();
  const joined = localAllSettled(routed);
  const value = await joined;
  assert.sameValue(value.length, 2); assert.compareArray(value.map(x => x.status), ["fulfilled", "fulfilled"]); for (const item of value) if (item.status === "fulfilled") assert.sameValue(item.value, undefined);
  console.log("settled-sparse:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
