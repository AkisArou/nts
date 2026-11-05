/*---
description: "Generator yields retain their positions in the result. Route: readonly tuple row (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Generator yields retain their positions in the result. Route: readonly tuple row. Node prints settled-generator:ok.
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
  function* stream(): Generator<Item> { yield 1; yield Promise.reject("fault"); yield 3; }
  const inputs: Iterable<Item> = stream();
  const rows: readonly [string, Iterable<Item>][] = [["s", inputs]]; const routed = rows[0][1];
  const joined = localAllSettled(routed);
  const value = await joined;
  assert.compareArray(value.map(x => x.status), ["fulfilled", "rejected", "fulfilled"]); if (value[1].status === "rejected") assert.sameValue(value[1].reason, "fault");
  console.log("settled-generator:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
