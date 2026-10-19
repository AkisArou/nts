/*---
description: A typed function's arguments object holds every argument passed, including extra ones given through a wider type.
features: [ts-functions]
---*/
function count(a: number, b?: number): number {
  return arguments.length;
}
const loose = count as (...args: number[]) => number;
assert.sameValue(count(1), 1);
assert.sameValue(count(1, 2), 2);
assert.sameValue(loose(1, 2, 3, 4), 4);
