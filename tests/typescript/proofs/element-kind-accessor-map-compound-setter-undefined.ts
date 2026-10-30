/*---
description: A compound assignment invokes a setter that stores undefined without deleting a Map entry.
features: [ts-proof-element-kind, ts-route-accessor, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-objects, ts-accessors, ts-closures, ts-spread, ts-expressions, ts-null-undefined]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the getter supplies zero and the setter receives the sum; node keeps the undefined entry after positive input.
function read(map: Map<string, number>): unknown { return [...map.entries()][0][1]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  const gate = {
    get amount(): number { return 0; },
    set amount(value: number) { if (value > 0) writable.set("item", undefined); }
  };
  const assigned = gate.amount += n;
  assert.sameValue(assigned, n);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const map = after(n);
  assert.sameValue(read(map), n > 0 ? undefined : 7);
  assert.sameValue(map.has("item"), true);
  assert.sameValue(map.has("missing"), false);
  assert.sameValue(map.size, 1);
}
