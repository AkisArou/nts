/*---
description: An own object cast to Math retains its min method.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-objects, ts-numbers, ts-closures]
---*/
// Route: an object is asserted to be Math; node calls the own min function.
function check(n: number): void {
  let calls = 0;
  const own = {
    min(a: number, b: number): number { calls++; return a + b + 100; }
  };
  const target = own as unknown as typeof Math;
  const value = target.min(n, n + 2);
  assert.sameValue(calls, 1);
  assert.sameValue(value, n + n + 102);
}
for (const n of [-3, 0, 1, 7]) check(n);
