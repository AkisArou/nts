/*---
description: "An indefinitely pending member does not prevent any from fulfilling. Route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// An indefinitely pending member does not prevent any from fulfilling. Route: readonly tuple row. Node prints any-pending-with-fulfillment:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [new Promise<Value>(() => {}), Promise.resolve("ready")];
  const rows: readonly [string, Iterable<Item>][] = [["x", inputs]]; const routed = rows[0][1];
  const result = Promise.any(routed);
  const value = await result;
  assert.sameValue(value, "ready");
  console.log("any-pending-with-fulfillment:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
