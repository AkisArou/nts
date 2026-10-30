/*---
description: The caller pops between next calls; the resumed guarded read is undefined.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-generators, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before yielding control to the caller.
// The caller pops between next calls; the resumed guarded read is undefined.
function* read(xs: number[]): Generator<number, number | undefined, void> {
  const index = 3;
  if (index < xs.length) { yield index; return xs[index]; }
  return -1;
}
for (const change of [-1, 0, 1, 4]) {
  const xs = [11, 22, 33, 44];
  const iterator = read(xs);
  assert.sameValue(iterator.next().value, 3);
  if (change > 0) xs.pop();
  const result = iterator.next();
  assert.sameValue(result.done, true);
  assert.sameValue(result.value, change > 0 ? undefined : 44);
}
