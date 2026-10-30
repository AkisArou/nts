/*---
description: Control for bounds-conversion-string-template-index-change; the invalidating route is removed.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects, ts-strings, ts-template-literals, ts-closures, ts-numbers, ts-to-string]
---*/
// Paired subject: ../proofs/bounds-conversion-string-template-index-change.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
function read(change: number): number {
  const text = "abcd";
  let index = 0;
  const hook = { toString(): string {  return "done"; } };
  `${hook}`;
  return text.charCodeAt(index);
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), 97);
