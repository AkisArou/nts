/*---
description: The caller transfers a yielded buffer before the generator reads its old view length.
features: [ts-proof-length, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-generators, ts-numbers]
---*/
// Fact: the view has length 4 (docs/foundations/objects.md, Typed arrays).
// Route: transfer across yield detaches it; node resumes with length 0.
function* viewLengths(): Generator<ArrayBuffer, number, void> {
  const buffer = new ArrayBuffer(8);
  const view = new Uint16Array(buffer);
  yield buffer;
  return view.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const iterator = viewLengths();
  const first = iterator.next();
  if (first.done) throw new Test262Error('expected yield');
  if (n > 0) first.value.transfer();
  const last = iterator.next();
  if (!last.done) throw new Test262Error('expected return');
  assert.sameValue(last.value, n > 0 ? 0 : 4);
}
