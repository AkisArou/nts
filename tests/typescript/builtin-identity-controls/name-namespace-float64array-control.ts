/*---
description: Control for name-namespace-float64array; the target resolves to the real Float64Array builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-numbers, ts-namespace]
flags: [module]
---*/
// Control for ../builtin-identity/name-namespace-float64array.ts: rename the shadow declaration.
export {};
let calls: number = 0;
namespace Local {
  class OwnFloat64Array {
    readonly length: number;
    [index: number]: number;
    constructor(values: number[]) {
      calls++; this.length = values.length;
      this[0] = values[0] + 10; this[1] = values[1] + 20;
    }
  }
  export function check(n: number): void {
    calls = 0;
    const result = new Float64Array([n, n + 1]);
    assert.sameValue(result.length, 2);
    assert.sameValue(result[0], n);
    assert.sameValue(result[1], n + 1);
    assert.sameValue(calls, 0);
  }
}
for (const n of [1, 3, 7]) Local.check(n);
