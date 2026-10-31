/*---
description: A conditional constructor value selects Array or an own class on both paths.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-class, ts-class-fields, ts-construct-signatures, ts-instanceof]
---*/
// Route: a structural constructor type admits Array and an own class; node constructs the selected class.
let constructions = 0;
class Own {
  length: number;
  constructor(n: number) { constructions++; this.length = n + 10; }
}
function check(useBuiltin: boolean, n: number): void {
  const Target: new (n: number) => { length: number } = useBuiltin ? Array : Own;
  const before = constructions;
  const result = new Target(n);
  assert.sameValue(constructions - before, useBuiltin ? 0 : 1);
  assert.sameValue(result.length, useBuiltin ? n : n + 10);
  assert.sameValue(result instanceof Array, useBuiltin);
  assert.sameValue(result instanceof Own, !useBuiltin);
}
for (const n of [0, 1, 3, 7]) {
  for (const useBuiltin of [false, true]) check(useBuiltin, n);
}
