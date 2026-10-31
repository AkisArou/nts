/*---
description: An own class cast to SetConstructor preserves its constructor and has method.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-map-set, ts-arrays, ts-instanceof]
---*/
// Route: a class is asserted to be Set; node searches the own translated element.
let calls = 0;
class OwnSet {
  readonly size: number = 1;
  readonly item: number;
  constructor(values: number[]) { calls++; this.item = values[0] + 100; }
  has(value: number): boolean { return value === this.item; }
}
function check(n: number): void {
  calls = 0;
  const Target = OwnSet as unknown as typeof Set;
  const value = new Target<number>([n]);
  assert.sameValue(calls, 1);
  assert.sameValue(value.size, 1);
  assert.sameValue(value.has(n), false);
  assert.sameValue(value.has(n + 100), true);
  assert.sameValue(value instanceof OwnSet, true);
  assert.sameValue(value instanceof Set, false);
}
for (const n of [-3, 0, 1, 7]) check(n);
