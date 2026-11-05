/*---
description: "Plain values remain unchanged inside fulfilled records. Route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Plain values remain unchanged inside fulfilled records. Route: readonly tuple row. Node prints settled-plain-mixed:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [1, "a", null, undefined];
  const rows: readonly [string, Iterable<Item>][] = [["s", inputs]]; const routed = rows[0][1];
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.compareArray(value.map(x => x.status), ["fulfilled", "fulfilled", "fulfilled", "fulfilled"]); if (value[2].status === "fulfilled") assert.sameValue(value[2].value, null); if (value[3].status === "fulfilled") assert.sameValue(value[3].value, undefined);
  console.log("settled-plain-mixed:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
