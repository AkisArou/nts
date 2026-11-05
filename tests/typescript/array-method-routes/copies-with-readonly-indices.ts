/*---
description: "With replaces the normalized positive negative fractional or NaN index in a fresh copy through readonly tuples of index and replacement arguments."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-tuples, ts-numbers, ts-strings]
---*/

// With replaces the normalized positive negative fractional or NaN index in a fresh copy; route: readonly tuples of index and replacement arguments.
// Node prints copies-with-readonly-indices:ok.
const input: readonly string[] = ["a", "b", "c"];
const rows: readonly [number, string, readonly string[]][] = [
  [0, "x", ["x", "b", "c"]], [-1, "z", ["a", "b", "z"]], [-3, "q", ["q", "b", "c"]],
  [1.7, "y", ["a", "y", "c"]], [-1.7, "z", ["a", "b", "z"]], [-0.7, "f", ["f", "b", "c"]],
  [-0, "zero", ["zero", "b", "c"]], [NaN, "nan", ["nan", "b", "c"]]
];
for (const [index, value, expected] of rows) {
  const result = input.with(index, value);
  assert.compareArray(result, expected);
  assert.sameValue(result === input, false);
  assert.compareArray(input, ["a", "b", "c"]);
}
console.log("copies-with-readonly-indices:ok");
