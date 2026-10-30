/*---
description: A do-while loop carries a shrinking length through its body and bottom condition.
features: [ts-proof-length, ts-route-loop, ts-arrays, ts-functions, ts-iteration]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: do-while repeats pop; node sees length max(4 - turns, 0), even at exit.
function lengthAfterPops(turns: number): number {
  const xs = [10, 20, 30, 40];
  let i = 0;
  let length = 4;
  do {
    if (i < turns) xs.pop();
    length = xs.length;
    i++;
  } while (i < turns);
  return length;
}

for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterPops(n), n < 4 ? 4 - n : 0);
}
