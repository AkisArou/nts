/*---
description: A function declaration is callable before the line that declares it.
features: [ts-functions]
---*/
const early = double(21);
function double(n: number): number {
  return n * 2;
}
assert.sameValue(early, 42);
