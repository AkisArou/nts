/*---
description: Finally removes the guarded suffix while an exception is caught.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before exception unwinding splices the array.
// Finally removes the guarded suffix while an exception is caught.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const index = 3;
  if (index < xs.length) {
    try {
      try { throw new Error("unwind"); }
      finally { if (change > 0) xs.splice(3, 1); }
    } catch {}
    return xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 44);
