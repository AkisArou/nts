/*---
description: Control for name-parameter-bigint64array; the target resolves to the real BigInt64Array builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-bigint, ts-construct-signatures]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-bigint64array.ts: pass the real builtin.
export {};
let calls: number = 0;
class OwnBigInt64Array {
  readonly length: number;
  [index: number]: bigint;
  constructor(values: bigint[]) {
    calls++; this.length = values.length;
    this[0] = values[0] + 10n; this[1] = values[1] + 20n;
  }
}

function check(BigInt64Array: new (values: bigint[]) => { readonly length: number; [index: number]: bigint }, n: bigint): void {
  calls = 0;
  const result = new BigInt64Array([n, n + 1n]);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1n);
  assert.sameValue(calls, 0);
}
for (const n of [1n, 3n, 7n]) check(BigInt64Array, n);
