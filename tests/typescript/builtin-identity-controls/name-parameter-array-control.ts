/*---
description: Control for name-parameter-array; the target resolves to the real Array builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-arrays, ts-generics, ts-construct-signatures]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-array.ts: pass the real builtin.
export {};
let calls: number = 0;
class OwnArray<T> {
  readonly length: number = 2;
  [index: number]: T | undefined;
  constructor(value: T) { calls++; this[0] = value; this[1] = value; }
}

function check(Array: new (value: number) => { readonly length: number; [index: number]: number | undefined }, n: number): void {
  calls = 0;
  const result = new Array(n);
  assert.sameValue(result.length, n);
  assert.sameValue(result[0], undefined);
  assert.sameValue(result[1], undefined);
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(Array, n);
