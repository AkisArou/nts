/*---
description: A Array subclass forwards typed arguments through its own constructor.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-arrays]
---*/
// Route: a typed Array subclass forwards typed arguments through its own constructor; node preserves the subclass and its behavior.
let constructions = 0;
class IdentityArray extends Array<number> {
  constructor(first: number, second: number) { super(first, second); constructions++; }
}
function check(n: number): void {
  const before = constructions;
  const result: number[] = new IdentityArray(n, n + 1);
  assert.sameValue(constructions - before, 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof IdentityArray, true);
  assert.sameValue(result instanceof Array, true);
  assert.sameValue(new Array<number>(n, n + 1) instanceof IdentityArray, false);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
