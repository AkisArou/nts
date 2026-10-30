/*---
description: A relayed writer stores a string that a callback reads from the original numeric Map.
features: [ts-proof-element-kind, ts-route-chain, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-function-types, ts-closures, ts-arrow-functions, ts-strings, ts-typeof-operator]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the relay chain reaches the widening writer; node preserves its string in Map.forEach.
function relay(write: () => void): () => void { return () => write(); }
function read(map: Map<string, number>): unknown {
  let result: unknown = undefined;
  map.forEach((value, key) => { if (key === "item") result = value; });
  return result;
}
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  const first = (): void => { if (n > 0) writable.set("item", "relay:" + n); };
  const a = relay(first), b = relay(a), c = relay(b), d = relay(c);
  const e = relay(d), f = relay(e), g = relay(f), h = relay(g);
  h();
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value, n > 0 ? "relay:" + n : 7);
  assert.sameValue(typeof value, n > 0 ? "string" : "number");
}
