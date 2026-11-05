/*---
description: "at reads each dense tuple slot, retains negative zero and distinguishes boundary misses from stored values. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-tuples, ts-readonly, ts-strings, ts-unions, ts-null-undefined, ts-typeof-operator]
---*/

function localAt<T>(items: readonly T[], index: number): T | undefined {
  if (index === Infinity || index === -Infinity) return undefined;
  const whole = index !== index ? 0 : index - index % 1;
  const position = whole < 0 ? items.length + whole : whole;
  for (let i = 0; i < items.length; i++) if (i === position) return items[i];
  return undefined;
}
// at reads each dense tuple slot, retains negative zero and distinguishes boundary misses from stored values. Route: a readonly heterogeneous tuple. Node prints reads-at-readonly-tuple:ok.
const items: readonly [string, null, undefined, number] = ["head", null, undefined, -0];
const indices: readonly number[] = [0, 1, 2, 3, -1, -4, -5, 4, 2.9, -0.9];
const expected: readonly (string | null | undefined | number)[] = ["head", null, undefined, -0, -0, "head", undefined, undefined, undefined, "head"];
for (let i = 0; i < indices.length; i++) {
  const found = localAt(items, indices[i]);
  assert.sameValue(found, expected[i]);
  if (typeof found === "number") assert.sameValue(Object.is(found, -0), true);
}
assert.compareArray(items, ["head", null, undefined, -0]);
console.log("reads-at-readonly-tuple:ok");
