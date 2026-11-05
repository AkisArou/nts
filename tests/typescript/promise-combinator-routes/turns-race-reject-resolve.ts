/*---
description: "Race ignores resolve after thenable reject. Route: Map lookup"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Race ignores resolve after thenable reject. Route: Map lookup. Node prints turns-race-reject-resolve:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { reject(reason); resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  const map = new Map<string, Iterable<Item>>(); map.set("x", inputs); const stored = map.get("x"); if (stored === undefined) throw new Error("missing"); const routed = stored;
  const joined = Promise.race(routed);
  let caught: unknown; try { await joined; } catch (error: unknown) { caught = error; }
  assert.sameValue(caught, reason);
  console.log("turns-race-reject-resolve:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
