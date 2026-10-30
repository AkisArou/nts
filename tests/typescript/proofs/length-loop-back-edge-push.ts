/*---
description: An allocation's length changes across each loop back edge that appends an element.
features: [ts-proof-length, ts-route-loop, ts-arrays, ts-functions, ts-iteration]
---*/
// Fact: the literal has length 2 (docs/foundations/objects.md, Arrays).
// Route: each back edge carries the preceding push; node sees every new length.
function lengthAfterPushes(turns: number): number {
  const xs = [10, 20];
  let previous = 0;
  for (let i = 0; i < turns; i++) {
    previous = xs.length;
    xs.push(i);
  }
  return previous + xs.length;
}

for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterPushes(n), n === 0 ? 2 : 2 * n + 3);
}
