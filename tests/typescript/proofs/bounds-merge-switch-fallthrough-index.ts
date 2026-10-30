/*---
description: A switch fall-through can move a formerly small index past a string's end.
features: [ts-proof-bounds, ts-route-merge, ts-strings, ts-functions, ts-iteration, ts-expressions]
---*/
// docs/foundations/numbers.md, Integers proved from doubles: j starts at 0.
// Fall-through adds 4 before the switch joins; node's charAt gives "" past end.
function characterAfterSwitch(n: number): string {
  let j = 0;
  switch (n) {
    case 0:
      j = 1;
      break;
    case 1:
      j = 2;
    case 2:
      j += 4;
      break;
    default:
      j = 3;
  }
  return "abcd".charAt(j);
}

for (const n of [0, 1, 2, 3, 7, -1]) {
  assert.sameValue(characterAfterSwitch(n), n === 0 ? "b" : n === 1 || n === 2 ? "" : "d");
}
