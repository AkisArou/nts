/*---
description: Control for cast-boolean-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-boolean-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnBox {
  readonly item: boolean;
  constructor(input: boolean) { calls++; this.item = !input; }
  valueOf(): boolean { return this.item; }
}
function check(input: boolean): void {
  calls = 0;
  const Target = Boolean;
  const value = new Target(input);
  assert.sameValue(calls, 0);
  assert.sameValue(value.valueOf(), input);
  assert.sameValue(value instanceof OwnBox, false);
  assert.sameValue(value instanceof Boolean, true);
}
for (const input of [false, true, false, true]) check(input);
