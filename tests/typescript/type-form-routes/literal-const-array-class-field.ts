/*---
description: "A const-asserted array built from a spread remains writable through an indexed alias after storage in a class field holding a readonly array."
features: [ts-type-form-routes, ts-type-form-route-literal, ts-as-const, ts-class, ts-class-fields, ts-readonly, ts-arrays, ts-iteration, ts-spread, ts-unknown, ts-typeof-operator, ts-index-signatures]
---*/
// as const creates a readonly array type across a class field; node retains indexed writes and array identity.
class ArrayHolder {
  values: readonly number[];
  constructor(values: readonly number[]) { this.values = values; }
}
const replacements: unknown[] = [-0, NaN, "changed", false, undefined, { id: 4 }];
for (const replacement of replacements) {
  const input: number[] = [3, 7, 11];
  const values = [...input] as const;
  const route = new ArrayHolder(values);
  const writable: { [index: number]: unknown } = route.values;
  writable[1] = replacement;
  assert.sameValue(route.values, values); assert.sameValue(Array.isArray(route.values), true);
  assert.sameValue(route.values.length, 3); assert.sameValue(typeof route.values.length, "number");
  const observed: number = route.values[1];
  assert.sameValue(observed, replacement); assert.sameValue(typeof observed, typeof replacement);
  assert.sameValue(route.values[0], 3); assert.sameValue(typeof route.values[0], "number");
  assert.sameValue(route.values[2], 11); assert.sameValue(typeof route.values[2], "number");
  assert.compareArray(input, [3, 7, 11]);
}
