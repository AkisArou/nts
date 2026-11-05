/*---
description: "Array.from keeps Set insertion order, unique values and object identity after later Set writes."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-objects, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-this, ts-map-set, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Array.from keeps Set insertion order, unique values and object identity after later Set writes. Route: a declared public Set field. Node prints construction-from-set-public-field:ok.
type FromMember = number | string | null | undefined | { id: number };
const marker = { id: 7 };
class SetHolder { values: Set<FromMember>; constructor(values: Set<FromMember>) { this.values = values; } }
const rows: readonly [Set<FromMember>, readonly FromMember[]][] = [
  [new Set<FromMember>(), []], [new Set<FromMember>([marker, marker]), [marker]],
  [new Set<FromMember>([NaN, NaN, -0, 0, "x", null, undefined, marker, marker]), [NaN, 0, "x", null, undefined, marker]]
];
for (const [source, expected] of rows) {
  const holder = new SetHolder(source), result = Array.from(holder.values);
  assert.compareArray(result, expected);
  for (let i = 0; i < expected.length; i++) {
    assert.sameValue(Object.is(result[i], expected[i]), true);
    if (expected[i] === marker) assert.sameValue(result[i] === marker, true);
  }
  holder.values.add("later");
  assert.compareArray(result, expected); assert.sameValue(holder.values.size, expected.length + 1);
}
console.log("construction-from-set-public-field:ok");
