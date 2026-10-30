/*---
description: Loop appends invalidate the source length inherited by a mapped allocation.
features: [ts-proof-length, ts-route-loop, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: map gives length 4 (docs/foundations/objects.md, Arrays).
// Route: loop pushes grow that result; node reads 4 + turns.
function increment(value: number): number { return value + 1; }
function mappedLengthAfterLoop(turns: number): number {
  const source = [10, 20, 30, 40];
  const mapped = source.map(increment);
  for (let i = 0; i < turns; i++) mapped.push(i);
  return mapped.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(mappedLengthAfterLoop(n), 4 + n);
}
