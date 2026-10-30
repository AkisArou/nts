/*---
description: A call changes the captured index from 0 to 4; charCodeAt gives NaN.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-closures, ts-numbers]
---*/
// docs/foundations/objects.md, Arrays: the captured index initially equals 0 in a four-character string.
// A call changes the captured index from 0 to 4; charCodeAt gives NaN.
function read(change: number): number {
  const text = "abcd";
  let index = 0;
  function move(): void { if (change > 0) index = 4; }
  move();
  return text.charCodeAt(index);
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? NaN : 97);
