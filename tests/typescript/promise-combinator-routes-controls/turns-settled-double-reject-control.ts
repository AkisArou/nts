/*---
description: "AllSettled ignores a second thenable reject after the first. Route: constrained generic helper (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// AllSettled ignores a second thenable reject after the first. Route: constrained generic helper. Node prints turns-settled-double-reject:ok.
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
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { reject(reason); reject(new Error("late")); } };
  const inputs: Iterable<Item> = [thenable];
  function forward<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = forward<Item>(inputs);
  const joined = localAllSettled(routed);
  const value = await joined;
  assert.sameValue(value.length, 1); assert.sameValue(value[0].status, "rejected");
  if (value[0].status === "rejected") assert.sameValue(value[0].reason, reason);
  console.log("turns-settled-double-reject:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
