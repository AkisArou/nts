/*---
description: Control for representation-set-functions-result-widened-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-function-types, ts-type-aliases, ts-unknown, ts-closures, ts-arrow-functions, ts-spread]
---*/
// Paired case: ../map-set-contents/representation-set-functions-result-widened-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
type Operation = (value: number) => number;
function check(n: number): void {
  let offset = n, calls = 0;
  const first: Operation = value => { calls++; return offset + value; };
  const second: Operation = value => { calls++; return offset - value; };
  const set = new Set<Operation>(); set.add(first); set.add(second);
  const reader: Set<Operation> = set;
  offset = n + 10;
  const seen = [...reader];
  assert.sameValue(reader.size, 2);
  assert.compareArray<unknown>(seen, [first, second]);
  assert.compareArray(seen.map(value => typeof value), ["function", "function"]);
  const a = seen[0](n + 2), b = seen[1](n + 2);
  assert.sameValue(a, 2 * n + 12); assert.sameValue(b, 8);
  assert.sameValue(typeof a, "number"); assert.sameValue(typeof b, "number");
  assert.sameValue(calls, 2);
}
for (const n of [-3, 0, 7]) check(n);
