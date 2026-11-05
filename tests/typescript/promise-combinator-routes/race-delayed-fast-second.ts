/*---
description: "A later input wins by settling earlier. Route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// A later input wins by settling earlier. Route: readonly tuple row. Node prints race-delayed-fast-second:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function later(value: Value, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => value); }
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [later("slow", 4), later("fast", 1)];
  const rows: readonly [string, Iterable<Item>][] = [["x", inputs]]; const routed = rows[0][1];
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, "fast");
  console.log("race-delayed-fast-second:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
