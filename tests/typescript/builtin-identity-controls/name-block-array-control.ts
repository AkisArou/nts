/*---
description: Control for name-block-array; the target resolves to the real Array builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-generics]
flags: [module]
---*/
// Control for ../builtin-identity/name-block-array.ts: rename the shadow declaration.
export {};
let calls: number = 0;
function check(n: number): void {
  {
    class OwnArray<T> {
      readonly length: number = 2;
      [index: number]: T | undefined;
      constructor(value: T) { calls++; this[0] = value; this[1] = value; }
    }
    calls = 0;
    const result = new Array<number>(n);
    assert.sameValue(result.length, n);
    assert.sameValue(result[0], undefined);
    assert.sameValue(result[1], undefined);
    assert.sameValue(calls, 0);
  }
}
for (const n of [1, 3, 7]) check(n);
