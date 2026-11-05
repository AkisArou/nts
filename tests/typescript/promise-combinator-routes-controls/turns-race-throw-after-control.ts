/*---
description: "Race ignores an exception thrown after thenable resolve. Route: Map lookup (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Race ignores an exception thrown after thenable resolve. Route: Map lookup. Node prints turns-race-throw-after:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localRace<T>(xs: Iterable<T>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    for (const input of xs) Promise.resolve(input).then(resolve, reject);
  });
}
async function main(): Promise<void> {
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { resolve(7); throw reason; } };
  const inputs: Iterable<Item> = [thenable];
  const map = new Map<string, Iterable<Item>>(); map.set("x", inputs); const stored = map.get("x"); if (stored === undefined) throw new Error("missing"); const routed = stored;
  const joined = localRace(routed);
  const value = await joined;
  assert.sameValue(value, 7);
  console.log("turns-race-throw-after:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
