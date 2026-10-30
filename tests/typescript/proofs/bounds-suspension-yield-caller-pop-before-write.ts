/*---
description: The caller pops across yield; the resumed write at old index 3 must append.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-generators]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before the caller can pop across yield.
// The caller pops across yield; the resumed write at old index 3 must append.
function* write(xs: number[], value: number): Generator<number, number, void> {
  const index = 3;
  if (index < xs.length) {
    yield index;
    xs[index] = value;
    return xs.length * 100 + xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) {
  const xs = [11, 22, 33, 44];
  const iterator = write(xs, 70 + change);
  assert.sameValue(iterator.next().value, 3);
  if (change > 0) xs.pop();
  const result = iterator.next();
  assert.sameValue(result.done, true);
  assert.sameValue(result.value, 470 + change);
}
