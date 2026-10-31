/*---
description: A namespace-scoped BigInt64Array namesake keeps its own constructor implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-bigint, ts-namespace]
flags: [module]
---*/
// Route: namespace binding named BigInt64Array; node runs the program's own implementation.
export {};
let calls: number = 0;
namespace Local {
  class BigInt64Array {
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
    assert.sameValue(result[0], n + 10n);
    assert.sameValue(result[1], n + 21n);
    assert.sameValue(calls, 1);
  }
}
for (const n of [1n, 3n, 7n]) Local.check(n);
