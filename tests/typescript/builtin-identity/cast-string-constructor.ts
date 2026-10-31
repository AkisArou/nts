/*---
description: An own class cast to String retains its constructor and primitive value.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-instanceof]
---*/
// Route: a class is asserted to be String; node runs its own valueOf method.
let calls = 0;
class OwnBox {
  readonly item: string;
  constructor(input: string) { calls++; this.item = "own:" + input; }
  valueOf(): string { return this.item; }
}
function check(input: string): void {
  calls = 0;
  const Target = OwnBox as unknown as typeof String;
  const value = new Target(input);
  assert.sameValue(calls, 1);
  assert.sameValue(value.valueOf(), "own:" + input);
  assert.sameValue(value instanceof OwnBox, true);
  assert.sameValue(value instanceof String, false);
}
for (const input of ["", "7", "text", "tail"]) check(input);
