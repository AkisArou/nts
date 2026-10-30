/*---
description: The caller grows an array while its generator is suspended at yield.
features: [ts-proof-length, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-generators]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: the caller unshifts across yield; node resumes with length 5, or 4.
function* lengths(): Generator<number[], number, void> {
  const xs = [10, 20, 30, 40];
  yield xs;
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const iterator = lengths();
  const first = iterator.next();
  if (first.done) throw new Test262Error('expected yield');
  if (n > 0) first.value.unshift(n);
  const last = iterator.next();
  if (!last.done) throw new Test262Error('expected return');
  assert.sameValue(last.value, n > 0 ? 5 : 4);
}
