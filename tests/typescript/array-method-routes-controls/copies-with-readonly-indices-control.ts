/*---
description: "With replaces the normalized positive negative fractional or NaN index in a fresh copy through readonly tuples of index and replacement arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-tuples, ts-numbers, ts-strings]
---*/

function localWith<T>(items: readonly T[], index: number, value: T): T[] {
  let target = index !== index ? 0 : index === Infinity || index === -Infinity ? index : index - index % 1;
  if (target < 0) target += items.length;
  if (!(target >= 0 && target < items.length)) throw new RangeError();
  const result: T[] = [];
  for (let i = 0; i < items.length; i++) result[i] = i === target ? value : items[i];
  return result;
}
// With replaces the normalized positive negative fractional or NaN index in a fresh copy; route: readonly tuples of index and replacement arguments.
// Node prints copies-with-readonly-indices:ok.
const input: readonly string[] = ["a", "b", "c"];
const rows: readonly [number, string, readonly string[]][] = [
  [0, "x", ["x", "b", "c"]], [-1, "z", ["a", "b", "z"]], [-3, "q", ["q", "b", "c"]],
  [1.7, "y", ["a", "y", "c"]], [-1.7, "z", ["a", "b", "z"]], [-0.7, "f", ["f", "b", "c"]],
  [-0, "zero", ["zero", "b", "c"]], [NaN, "nan", ["nan", "b", "c"]]
];
for (const [index, value, expected] of rows) {
  const result = localWith(input, index, value);
  assert.compareArray(result, expected);
  assert.sameValue(result === input, false);
  assert.compareArray(input, ["a", "b", "c"]);
}
console.log("copies-with-readonly-indices:ok");
