/*---
description: A type parameter constrained to string is used with string members, and a literal argument keeps its value.
features: [ts-generics, ts-generic-constraints, ts-literal-types]
---*/
function longest<T extends string>(values: T[]): T {
  let best = values[0];
  for (const value of values) if (value.length > best.length) best = value;
  return best;
}
type Color = "red" | "green" | "blue";
const colors: Color[] = ["red", "green", "blue"];
const picked: Color = longest(colors);
assert.sameValue(picked, "green");
assert.sameValue(longest(["a", "abc", "ab"]).toUpperCase(), "ABC");
