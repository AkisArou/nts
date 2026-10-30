/*---
description: A direct call that pops an array invalidates the guard that proved its last index safe.
features: [ts-proof-bounds, ts-route-call, ts-arrays, ts-functions, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: i < xs.length proves this array's bound.
// The intervening call may pop its last slot; node then reads undefined there.
function popLast(xs: number[], remove: boolean): void {
  if (remove) xs.pop();
}

function readAfterCall(i: number, remove: boolean): number | undefined {
  const xs = [10, 20, 30, 40];
  if (i >= 0 && i < xs.length) {
    popLast(xs, remove);
    return xs[i];
  }
  return -1;
}

for (const i of [0, 1, 3, 4, 7, -1, 2 ** 31 - 1]) {
  const before = i >= 0 && i < 4 ? (i + 1) * 10 : -1;
  assert.sameValue(readAfterCall(i, false), before);
  assert.sameValue(readAfterCall(i, true), i === 3 ? undefined : before);
}
