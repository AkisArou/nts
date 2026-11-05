/*---
description: "all preserves generator yield order despite mixed plain and promised values; route: discriminated union"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all preserves generator yield order despite mixed plain and promised values. Route: discriminated union. Node prints all-generator-yield-order:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
async function main(): Promise<void> {
  function* emit(): Generator<Entry> { yield Promise.resolve("a"); yield 3; yield "b"; }
  const inputs: Iterable<Entry> = emit();
  type Selection = { kind: "chosen"; items: Iterable<Entry> } | { kind: "other"; items: Iterable<Entry> };
  const selected: Selection = { kind: "chosen", items: inputs };
  const routed = selected.items;
  const joined = Promise.all(routed);
  const value = await joined;
  assert.compareArray(value, ["a", 3, "b"]);
  console.log("all-generator-yield-order:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
