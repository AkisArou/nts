/*---
description: "A numeric array hole becomes a fulfilled undefined race winner. Route: readonly tuple row (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// A numeric array hole becomes a fulfilled undefined race winner. Route: readonly tuple row. Node prints race-sparse-values:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localRace<T>(inputs: Iterable<T>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    for (const input of inputs) Promise.resolve(input).then(resolve, reject);
  });
}
async function main(): Promise<void> {
  const inputs: Iterable<Item> = new Array<number>(2);
  const rows: readonly [string, Iterable<Item>][] = [["x", inputs]]; const routed = rows[0][1];
  const joined = localRace(routed);
  const value = await joined;
  assert.sameValue(value, undefined);
  console.log("race-sparse-values:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
