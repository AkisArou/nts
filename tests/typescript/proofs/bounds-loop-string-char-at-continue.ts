/*---
description: A continued iteration carries index 4; charAt gives an empty string.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-strings]
---*/
// docs/foundations/objects.md, Arrays: index 0 starts below the string length 4.
// A continued iteration carries index 4; charAt gives an empty string.
function read(turns: number): string {
  const text = "abcd";
  let index = 0;
  let result = "a";
  for (let turn = 0; turn < turns; turn++) {
    if (turn === 0) { index = 4; continue; }
    result = text.charAt(index);
  }
  return result;
}
for (const turns of [0, 1, 2, 4, 7]) assert.sameValue(read(turns), turns < 2 ? "a" : "");
