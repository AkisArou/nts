/*---
description: An index range proved on one branch does not survive a join with an out-of-range branch.
features: [ts-proof-bounds, ts-route-merge, ts-strings, ts-numbers, ts-functions, ts-iteration]
---*/
// docs/foundations/numbers.md, Integers proved from doubles: guards bound j.
// The 0..3 branch joins j = 7; node's charCodeAt returns NaN on that route.
function codeAfterJoin(n: number): number {
  let j = 0;
  if (n >= 0 && n < 4) {
    j = n | 0;
  } else {
    j = 7;
  }
  return "abcd".charCodeAt(j);
}

for (const n of [0, 1, 3, 4, 7, -1, 2 ** 31 - 1]) {
  assert.sameValue(codeAfterJoin(n), n >= 0 && n < 4 ? 97 + n : NaN);
}
