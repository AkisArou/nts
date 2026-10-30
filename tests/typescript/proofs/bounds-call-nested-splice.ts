/*---
description: A shrink reached through two calls invalidates the caller's guarded array index.
features: [ts-proof-bounds, ts-route-call, ts-arrays, ts-functions, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded by this array's length.
// A nested splice removes its tail; node gives undefined after either call returns.
function removeTail(xs: number[], cut: number): void {
  xs.splice(cut);
}

function shorten(xs: number[], cut: number): void {
  if (cut < 4) removeTail(xs, cut);
}

function readAfterNestedCall(cut: number): number | undefined {
  const xs = [10, 20, 30, 40];
  const i = 3;
  if (i < xs.length) {
    shorten(xs, cut);
    return xs[i];
  }
  return -1;
}

for (const cut of [0, 1, 3, 4, 7]) {
  assert.sameValue(readAfterNestedCall(cut), cut < 4 ? undefined : 40);
}
