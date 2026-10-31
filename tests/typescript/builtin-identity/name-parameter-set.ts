/*---
description: A parameter-scoped Set namesake keeps its own constructor implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-map-set, ts-construct-signatures]
flags: [module]
---*/
// Route: typed parameter named Set; node runs the program's own implementation.
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
  assert.sameValue(result.size, n + 100);
  assert.sameValue(result.has(n), false);
  assert.sameValue(calls, 1);
}
for (const n of [1, 3, 7]) check(OwnSet, n);
