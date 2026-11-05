/*---
description: "A rejected record serializes status before reason. Route: interface field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// A rejected record serializes status before reason. Route: interface field. Node prints settled-json-rejection:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [Promise.reject("no")];
  interface Source { entries: Iterable<Item>; } const source: Source = { entries: inputs }; const routed = source.entries;
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.sameValue(JSON.stringify(value), '[{"status":"rejected","reason":"no"}]');
  console.log("settled-json-rejection:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
