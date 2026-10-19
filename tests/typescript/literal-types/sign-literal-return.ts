/*---
description: A function returning a union of -1, 0 and 1 sorts values through its result.
features: [ts-literal-types, ts-unions]
---*/
function compare(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}
const words = ["pear", "apple", "fig", "apple"];
assert.compareArray([...words].sort(compare), ["apple", "apple", "fig", "pear"]);
assert.sameValue(compare("a", "a"), 0);
assert.sameValue(compare("b", "a") * 2, 2);
