/*---
description: An own object cast to Math retains its deterministic random method.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-objects, ts-numbers, ts-closures]
---*/
// Route: an object is asserted to be Math; node returns the own input-dependent number.
function check(n: number): void {
  let calls = 0;
  const own = {
    random(): number { calls++; return n + 100; }
  };
  const target = own as unknown as typeof Math;
  const value = target.random();
  assert.sameValue(calls, 1);
  assert.sameValue(value, n + 100);
}
for (const n of [0, 1, 3, 7]) check(n);
