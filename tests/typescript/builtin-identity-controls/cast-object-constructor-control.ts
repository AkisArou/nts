/*---
description: Control for cast-object-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-objects, ts-narrowing, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-object-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnObject {
  readonly item: number;
  constructor(input: { item: number }) { calls++; this.item = input.item + 100; }
}
function check(n: number): void {
  calls = 0;
  const input = { item: n };
  const Target = Object;
  const value: object = new Target(input);
  assert.sameValue(calls, 0);
  assert.sameValue(value === input, true);
  assert.sameValue(value instanceof OwnObject, false);
  assert.sameValue(value instanceof Object, true);
  if (!("item" in value)) throw new Test262Error("missing item");
  assert.sameValue(value.item, n);
}
for (const n of [-3, 0, 1, 7]) check(n);
