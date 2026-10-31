/*---
description: Control for name-namespace-array; the target resolves to the real Array builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-generics, ts-namespace]
flags: [module]
---*/
// Control for ../builtin-identity/name-namespace-array.ts: rename the shadow declaration.
export {};
let calls: number = 0;
namespace Local {
  class OwnArray<T> {
    readonly length: number = 2;
    [index: number]: T | undefined;
    constructor(value: T) { calls++; this[0] = value; this[1] = value; }
  }
  export function check(n: number): void {
    calls = 0;
    const result = new Array<number>(n);
    assert.sameValue(result.length, n);
    assert.sameValue(result[0], undefined);
    assert.sameValue(result[1], undefined);
    assert.sameValue(calls, 0);
  }
}
for (const n of [1, 3, 7]) Local.check(n);
