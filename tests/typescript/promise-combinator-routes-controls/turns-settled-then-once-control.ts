/*---
description: "AllSettled calls an adopted thenable's then exactly once. Route: constrained generic helper (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// AllSettled calls an adopted thenable's then exactly once. Route: constrained generic helper. Node prints turns-settled-then-once:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localAllSettled<T>(xs: Iterable<T>): Promise<PromiseSettledResult<Awaited<T>>[]> {
  return new Promise(resolve => {
    const records: PromiseSettledResult<Awaited<T>>[] = []; let left = 1, index = 0;
    for (const input of xs) {
      const i = index++; left++;
      Promise.resolve(input).then(value => { records[i] = { status: "fulfilled", value }; if (--left === 0) resolve(records); },
        (reason: unknown) => { records[i] = { status: "rejected", reason }; if (--left === 0) resolve(records); });
    }
    if (--left === 0) resolve(records);
  });
}
async function main(): Promise<void> {
  let calls = 0; const thenable: Thenable = { then(resolve, reject): void { calls++; resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  function forward<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = forward<Item>(inputs);
  const joined = localAllSettled(routed);
  await joined;
  assert.sameValue(calls, 1);
  console.log("turns-settled-then-once:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
