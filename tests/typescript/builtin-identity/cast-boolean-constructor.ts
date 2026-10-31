/*---
description: An own class cast to Boolean retains its constructor and primitive value.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-instanceof]
---*/
// Route: a class is asserted to be Boolean; node runs its own valueOf method.
let calls = 0;
class OwnBox {
  readonly item: boolean;
  constructor(input: boolean) { calls++; this.item = !input; }
  valueOf(): boolean { return this.item; }
}
function check(input: boolean): void {
  calls = 0;
  const Target = OwnBox as unknown as typeof Boolean;
  const value = new Target(input);
  assert.sameValue(calls, 1);
  assert.sameValue(value.valueOf(), !input);
  assert.sameValue(value instanceof OwnBox, true);
  assert.sameValue(value instanceof Boolean, false);
}
for (const input of [false, true, false, true]) check(input);
