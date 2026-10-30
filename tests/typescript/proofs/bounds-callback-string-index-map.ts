/*---
description: map's callback changes a captured index; charCodeAt gives NaN.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions, ts-strings, ts-numbers]
---*/
// docs/foundations/objects.md, Arrays: the captured index starts at 0 below the string length 4.
// map's callback changes a captured index; charCodeAt gives NaN.
function read(change: number): number {
  const text = "abcd";
  let index = 0;
  [0, 1].map((step) => { if (step === 0 && change > 0) index = 4; return step; });
  return text.charCodeAt(index);
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? NaN : 97);
