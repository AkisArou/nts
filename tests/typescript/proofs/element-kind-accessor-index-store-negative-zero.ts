/*---
description: A setter stores an observable negative zero into an initially integral array.
features: [ts-proof-element-kind, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-accessors, ts-objects]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a setter writes -0; the separate reader must preserve its sign.
function readFirst(xs: number[]): number { return xs[0]; }
function observe(n: number): number {
  const xs = [1, 2];
  const hook = {
    set value(value: number) { xs[0] = value; }
  };
  hook.value = n > 0 ? -0 : 0;
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? -0 : 0);
}
