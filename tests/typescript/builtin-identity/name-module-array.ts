/*---
description: A module-scoped Array namesake keeps its own constructor implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-generics]
flags: [module]
---*/
// Route: module binding named Array; node runs the program's own implementation.
export {};
let calls: number = 0;
class Array<T> {
  readonly length: number = 2;
  [index: number]: T | undefined;
  constructor(value: T) { calls++; this[0] = value; this[1] = value; }
}

function check(n: number): void {
  calls = 0;
  const result = new Array<number>(n);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n);
  assert.sameValue(calls, 1);
}
for (const n of [1, 3, 7]) check(n);
