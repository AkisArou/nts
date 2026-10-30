/*---
description: A finally assignment preserves negative zero through the post-try join.
features: [ts-proof-negative-zero, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-errors]
---*/
// Fact: the binding initially holds positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: finally writes -0 on the positive arm; node preserves it at the later read.
function afterJoin(n: number): number {
  let value = 0;
  try {
    if (n === 0) value = 1;
  } finally {
    if (n > 0) value = -0;
  }
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? -0 : n === 0 ? 1 : 0);
}
