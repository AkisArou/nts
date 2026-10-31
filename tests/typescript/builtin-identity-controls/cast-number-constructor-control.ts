/*---
description: Control for cast-number-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-number-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnBox {
  readonly item: number;
  constructor(input: number) { calls++; this.item = input + 100; }
  valueOf(): number { return this.item; }
}
function check(input: number): void {
  calls = 0;
  const Target = Number;
  const value = new Target(input);
  assert.sameValue(calls, 0);
  assert.sameValue(value.valueOf(), input);
  assert.sameValue(value instanceof OwnBox, false);
  assert.sameValue(value instanceof Number, true);
}
for (const input of [-3, 0, 1.5, 7]) check(input);
