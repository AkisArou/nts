/*---
description: Control for name-parameter-float32array; the target resolves to the real Float32Array builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-numbers, ts-construct-signatures]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-float32array.ts: pass the real builtin.
export {};
let calls: number = 0;
class OwnFloat32Array {
  readonly length: number;
  [index: number]: number;
  constructor(values: number[]) {
    calls++; this.length = values.length;
    this[0] = values[0] + 10; this[1] = values[1] + 20;
  }
}

function check(Float32Array: new (values: number[]) => { readonly length: number; [index: number]: number }, n: number): void {
  calls = 0;
  const result = new Float32Array([n, n + 1]);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(Float32Array, n);
