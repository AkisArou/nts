/*---
description: A non-null boolean array element preserves explicit undefined and past-end absence beside false and true. The control uses honest types.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-null-undefined, ts-unions, ts-unknown, ts-typeof-operator, ts-errors]
---*/
// A non-null claim on a typed array element crosses runtime indices; node keeps both false and true and returns undefined outside the array. The control states the possible value honestly.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const values: (boolean | undefined)[] = [false, true, undefined];
const rows: [number, boolean | undefined][] = [
  [-1, undefined], [0, false], [1, true], [2, undefined], [3, undefined], [7, undefined]
];
for (const [index, expected] of rows) {
  const value: boolean | undefined = values[index];
  same(value, expected);
  same(values.length, 3);
  same(Object.hasOwn(values, index), index >= 0 && index < 3);
  if (expected === undefined) assert.throws(TypeError, () => Boolean.prototype.valueOf.call(value));
  else same(Boolean.prototype.valueOf.call(value), expected);
}
