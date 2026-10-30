/*---
description: A forEach callback can remove the slot licensed by an earlier array length guard.
features: [ts-proof-bounds, ts-route-callback, ts-arrays, ts-functions, ts-arrow-functions, ts-closures, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is below xs.length at the guard.
// forEach runs a callback that pops xs; node's later read is undefined.
function readAfterForEach(n: number): number | undefined {
  const xs = [10, 20, 30, 40];
  const i = 3;
  if (i < xs.length) {
    [0, 1, 2].forEach((step) => {
      if (step < n) xs.pop();
    });
    return xs[i];
  }
  return -1;
}

for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(readAfterForEach(n), n > 0 ? undefined : 40);
}
