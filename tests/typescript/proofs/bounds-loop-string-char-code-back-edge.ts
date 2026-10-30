/*---
description: A later charCodeAt(4) on abcd gives NaN.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers]
---*/
// docs/foundations/objects.md, Arrays: index 0 starts below the string length 4.
// A later charCodeAt(4) on abcd gives NaN.
function read(turns: number): number {
  const text = "abcd";
  let index = 0;
  let result = 97;
  for (let turn = 0; turn < turns; turn++) {
    result = text.charCodeAt(index);
    index = 4;
  }
  return result;
}
for (const turns of [0, 1, 2, 4, 7]) assert.sameValue(read(turns), turns < 2 ? 97 : NaN);
