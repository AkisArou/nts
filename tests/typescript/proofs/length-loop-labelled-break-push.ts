/*---
description: A labelled break carries the length changed by earlier nested-loop iterations.
features: [ts-proof-length, ts-route-loop, ts-arrays, ts-functions, ts-iteration]
---*/
// Fact: the literal has length 1 (docs/foundations/objects.md, Arrays).
// Route: an inner loop breaks the outer loop after pushes; node keeps stop + 1.
function lengthAtBreak(stop: number): number {
  const xs = [10];
  outer: for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const position = row * 3 + column;
      if (position === stop) break outer;
      xs.push(position);
    }
  }
  return xs.length;
}

for (const n of [0, 1, 3, 4, 7, 9]) {
  assert.sameValue(lengthAtBreak(n), n + 1);
}
