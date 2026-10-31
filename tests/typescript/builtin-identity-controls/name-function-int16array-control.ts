/*---
description: Control for name-function-int16array; the target resolves to the real Int16Array builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-numbers]
flags: [module]
---*/
// Control for ../builtin-identity/name-function-int16array.ts: rename the shadow declaration.
export {};
let calls: number = 0;
function check(n: number): void {
  class OwnInt16Array {
    readonly length: number;
    [index: number]: number;
    constructor(values: number[]) {
      calls++; this.length = values.length;
      this[0] = values[0] + 10; this[1] = values[1] + 20;
    }
  }
  calls = 0;
  const result = new Int16Array([n, n + 1]);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(n);
