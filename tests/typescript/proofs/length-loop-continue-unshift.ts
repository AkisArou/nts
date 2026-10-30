/*---
description: An unshift reaches the next length read through a continue edge.
features: [ts-proof-length, ts-route-loop, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: the literal has length 2 (docs/foundations/objects.md, Arrays).
// Route: continue carries an unshift; node reads 3 on the next iteration.
function lengthAfterContinue(turns: number): number {
  const xs = [10, 20];
  let seen = 2;
  for (let i = 0; i < turns; i++) {
    if (i === 0) {
      xs.unshift(30);
      continue;
    }
    seen = xs.length;
  }
  return seen;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(lengthAfterContinue(n), n < 2 ? 2 : 3);
}
