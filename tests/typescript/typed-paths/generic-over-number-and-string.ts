/*---
description: One generic function, instantiated at a number and at a string.
features: [ts-generics]
---*/
function first<T>(items: T[]): T {
  return items[0];
}
assert.sameValue(first([3, 4]) + 1, 4);
assert.sameValue(first(["a", "b"]) + "!", "a!");
