/*---
description: Control for representation-map-bigints-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-bigint, ts-spread]
---*/
// Paired case: ../map-set-contents/representation-map-bigints-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(n: bigint): void {
  const map = new Map<string, bigint>();
  map.set("first", n); map.set("second", n + 1n);
  const reader: Map<string, bigint> = map;
  assert.sameValue(reader.get("first"), n);
  assert.sameValue(reader.get("second"), n + 1n);
  assert.sameValue(typeof reader.get("first"), "bigint");
  assert.sameValue(typeof reader.get("second"), "bigint");
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["first", "second"]);
  assert.compareArray<unknown>([...reader.values()], [n, n + 1n]);
}
for (const n of [0n, -1n, 2147483648n, 9007199254740993n, 1267650600228229401496703205376n]) check(n);
