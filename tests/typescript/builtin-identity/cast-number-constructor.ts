/*---
description: An own class cast to Number retains its constructor and primitive value.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-instanceof]
---*/
// Route: a class is asserted to be Number; node runs its own valueOf method.
let calls = 0;
class OwnBox {
  readonly item: number;
  constructor(input: number) { calls++; this.item = input + 100; }
  valueOf(): number { return this.item; }
}
function check(input: number): void {
  calls = 0;
  const Target = OwnBox as unknown as typeof Number;
  const value = new Target(input);
  assert.sameValue(calls, 1);
  assert.sameValue(value.valueOf(), input + 100);
  assert.sameValue(value instanceof OwnBox, true);
  assert.sameValue(value instanceof Number, false);
}
for (const input of [-3, 0, 1.5, 7]) check(input);
