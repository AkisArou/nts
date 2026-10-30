/*---
description: A caller stores negative zero while the array reader is suspended at yield.
features: [ts-proof-element-kind, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-generators]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: the caller writes -0 across yield; the separate resumed reader keeps it.
function readFirst(xs: number[]): number { return xs[0]; }
function* observe(): Generator<number[], number, void> {
  const xs = [1, 2];
  yield xs;
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  const iterator = observe();
  const first = iterator.next();
  if (first.done) throw new Test262Error('expected yield');
  if (n > 0) first.value[0] = -0;
  const last = iterator.next();
  if (!last.done) throw new Test262Error('expected return');
  assert.sameValue(last.value, n > 0 ? -0 : 1);
}
