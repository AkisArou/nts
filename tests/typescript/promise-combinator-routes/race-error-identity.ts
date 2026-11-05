/*---
description: "The winning rejection preserves its Error identity. Route: Map lookup"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// The winning rejection preserves its Error identity. Route: Map lookup. Node prints race-error-identity:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new RangeError("fault");
  const inputs: Iterable<Item> = [Promise.reject(reason), Promise.resolve(3)];
  const map = new Map<string, Iterable<Item>>(); map.set("x", inputs); const found = map.get("x"); if (found === undefined) throw new Error("missing"); const routed = found;
  const joined = Promise.race(routed);
  let caught: unknown; try { await joined; } catch (error: unknown) { caught = error; }
  assert.sameValue(caught, reason);
  assert.sameValue(caught instanceof RangeError, true);
  console.log("race-error-identity:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
