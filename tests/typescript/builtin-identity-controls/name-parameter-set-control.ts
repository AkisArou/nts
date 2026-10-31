/*---
description: Control for name-parameter-set; the target resolves to the real Set builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-map-set, ts-construct-signatures]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-set.ts: pass the real builtin.
export {};
let calls: number = 0;
class OwnSet {
  readonly size: number;
  readonly saved: number;
  constructor(values: number[]) { calls++; this.saved = values[0]; this.size = this.saved + 100; }
  has(value: number): boolean { return value === this.saved + 1; }
}

function check(Set: new (values: number[]) => { readonly size: number; has(value: number): boolean }, n: number): void {
  calls = 0;
  const result = new Set([n, n + 1]);
  assert.sameValue(result.size, 2);
  assert.sameValue(result.has(n), true);
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(Set, n);
