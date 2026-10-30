/*---
description: A map callback's length assignment invalidates a guarded read of its captured array.
features: [ts-proof-bounds, ts-route-callback, ts-arrays, ts-functions, ts-arrow-functions, ts-closures, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded by the literal's length.
// map runs a callback that shrinks the captured array; node reads undefined.
function readAfterMap(n: number): number | undefined {
  const xs = [10, 20, 30, 40];
  const i = 3;
  if (i < xs.length) {
    [0, 1].map((step) => {
      if (step === n) xs.length = 1;
      return step + 1;
    });
    return xs[i];
  }
  return -1;
}

for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(readAfterMap(n), n === 0 || n === 1 ? undefined : 40);
}
