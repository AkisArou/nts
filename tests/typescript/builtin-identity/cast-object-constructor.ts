/*---
description: An own class cast to ObjectConstructor constructs a new own instance.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-objects, ts-narrowing, ts-instanceof]
---*/
// Route: a class is asserted to be Object; node runs it instead of returning the argument.
let calls = 0;
class OwnObject {
  readonly item: number;
  constructor(input: { item: number }) { calls++; this.item = input.item + 100; }
}
function check(n: number): void {
  calls = 0;
  const input = { item: n };
  const Target = OwnObject as unknown as typeof Object;
  const value: object = new Target(input);
  assert.sameValue(calls, 1);
  assert.sameValue(value === input, false);
  assert.sameValue(value instanceof OwnObject, true);
  assert.sameValue(value instanceof Object, true);
  if (!("item" in value)) throw new Test262Error("missing item");
  assert.sameValue(value.item, n + 100);
}
for (const n of [-3, 0, 1, 7]) check(n);
