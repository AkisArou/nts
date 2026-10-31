/*---
description: Control for cast-set-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-map-set, ts-arrays, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-set-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnSet {
  readonly size: number = 1;
  readonly item: number;
  constructor(values: number[]) { calls++; this.item = values[0] + 100; }
  has(value: number): boolean { return value === this.item; }
}
function check(n: number): void {
  calls = 0;
  const Target = Set;
  const value = new Target<number>([n]);
  assert.sameValue(calls, 0);
  assert.sameValue(value.size, 1);
  assert.sameValue(value.has(n), true);
  assert.sameValue(value.has(n + 100), false);
  assert.sameValue(value instanceof OwnSet, false);
  assert.sameValue(value instanceof Set, true);
}
for (const n of [-3, 0, 1, 7]) check(n);
