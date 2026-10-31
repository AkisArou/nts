/*---
description: A function-scoped Uint16Array namesake keeps its own constructor implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-numbers]
flags: [module]
---*/
// Route: function binding named Uint16Array; node runs the program's own implementation.
export {};
let calls: number = 0;
function check(n: number): void {
  class Uint16Array {
    readonly length: number;
    [index: number]: number;
    constructor(values: number[]) {
      calls++; this.length = values.length;
      this[0] = values[0] + 10; this[1] = values[1] + 20;
    }
  }
  calls = 0;
  const result = new Uint16Array([n, n + 1]);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n + 10);
  assert.sameValue(result[1], n + 21);
  assert.sameValue(calls, 1);
}
for (const n of [1, 3, 7]) check(n);
