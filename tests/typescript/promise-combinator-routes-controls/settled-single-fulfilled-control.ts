/*---
description: "A fulfilled record has value but no reason. Route: generic helper (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// A fulfilled record has value but no reason. Route: generic helper. Node prints settled-single-fulfilled:ok.
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
  const inputs: Iterable<Item> = [8];
  function pass<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = pass<Item>(inputs);
  const joined = localAllSettled(routed);
  const value = await joined;
  assert.sameValue(value[0].status, "fulfilled"); assert.sameValue("reason" in value[0], false); if (value[0].status === "fulfilled") assert.sameValue(value[0].value, 8);
  console.log("settled-single-fulfilled:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
