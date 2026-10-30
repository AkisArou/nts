/*---
description: A recursive callee's length assignment invalidates the caller's guarded index.
features: [ts-proof-bounds, ts-route-call, ts-arrays, ts-functions, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 starts within a literal's length.
// The recursive base case shrinks it to 1; node's read after the call is undefined.
function shrinkAtBottom(xs: number[], depth: number): void {
  if (depth <= 0) return;
  if (depth === 1) {
    xs.length = 1;
    return;
  }
  shrinkAtBottom(xs, depth - 1);
}

function readAfterRecursion(depth: number): number | undefined {
  const xs = [10, 20, 30, 40];
  const i = 3;
  if (i < xs.length) {
    shrinkAtBottom(xs, depth);
    return xs[i];
  }
  return -1;
}

for (const depth of [-1, 0, 1, 2, 7]) {
  assert.sameValue(readAfterRecursion(depth), depth > 0 ? undefined : 40);
}
