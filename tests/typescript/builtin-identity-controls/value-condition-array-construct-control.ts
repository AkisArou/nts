/*---
description: Control for value-condition-array-construct; construct Array directly instead of the conditional target; adjust its expected observations.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-class, ts-class-fields, ts-construct-signatures, ts-instanceof]
---*/
// Paired case: ../builtin-identity/value-condition-array-construct.ts.
// Change: Construct Array directly instead of the conditional target; adjust its expected observations.
let constructions = 0;
class Own {
  length: number;
  constructor(n: number) { constructions++; this.length = n + 10; }
}
function check(useBuiltin: boolean, n: number): void {
  const Target: new (n: number) => { length: number } = useBuiltin ? Array : Own;
  const before = constructions;
  const result = new Array<number>(n);
  assert.sameValue(constructions - before, 0);
  assert.sameValue(result.length, n);
  assert.sameValue(result instanceof Array, true);
  assert.sameValue(result instanceof Own, false);
}
for (const n of [0, 1, 3, 7]) {
  for (const useBuiltin of [false, true]) check(useBuiltin, n);
}
