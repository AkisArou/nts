/*---
description: Control for name-namespace-bigint64array; the target resolves to the real BigInt64Array builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-bigint, ts-namespace]
flags: [module]
---*/
// Control for ../builtin-identity/name-namespace-bigint64array.ts: rename the shadow declaration.
export {};
let calls: number = 0;
namespace Local {
  class OwnBigInt64Array {
    readonly length: number;
    [index: number]: bigint;
    constructor(values: bigint[]) {
      calls++; this.length = values.length;
      this[0] = values[0] + 10n; this[1] = values[1] + 20n;
    }
  }
  export function check(n: bigint): void {
    calls = 0;
    const result = new BigInt64Array([n, n + 1n]);
    assert.sameValue(result.length, 2);
    assert.sameValue(result[0], n);
    assert.sameValue(result[1], n + 1n);
    assert.sameValue(calls, 0);
  }
}
for (const n of [1n, 3n, 7n]) Local.check(n);
