/*---
description: Control for cast-string-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-string-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnBox {
  readonly item: string;
  constructor(input: string) { calls++; this.item = "own:" + input; }
  valueOf(): string { return this.item; }
}
function check(input: string): void {
  calls = 0;
  const Target = String;
  const value = new Target(input);
  assert.sameValue(calls, 0);
  assert.sameValue(value.valueOf(), input);
  assert.sameValue(value instanceof OwnBox, false);
  assert.sameValue(value instanceof String, true);
}
for (const input of ["", "7", "text", "tail"]) check(input);
