/*---
description: A sort comparator can pop a different array between its bounds guard and element read.
features: [ts-proof-bounds, ts-route-callback, ts-arrays, ts-functions, ts-arrow-functions, ts-closures, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 starts below xs.length.
// The comparator pops xs once, regardless of comparison count; node reads undefined.
function readAfterSort(n: number): number | undefined {
  const xs = [10, 20, 30, 40];
  const order = [3, 1, 2];
  let popped = false;
  const i = 3;
  if (i < xs.length) {
    order.sort((a, b) => {
      if (n > 0 && !popped) {
        xs.pop();
        popped = true;
      }
      return a - b;
    });
    return xs[i];
  }
  return -1;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(readAfterSort(n), n > 0 ? undefined : 40);
}
