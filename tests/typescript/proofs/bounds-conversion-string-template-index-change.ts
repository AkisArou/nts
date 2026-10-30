/*---
description: Template conversion changes a captured index; charCodeAt gives NaN.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects, ts-strings, ts-template-literals, ts-closures, ts-numbers, ts-to-string]
---*/
// docs/foundations/objects.md, Arrays: numeric index 0 is in range before template conversion invokes toString.
// Template conversion changes a captured index; charCodeAt gives NaN.
function read(change: number): number {
  const text = "abcd";
  let index = 0;
  const hook = { toString(): string { if (change > 0) index = 4; return "done"; } };
  `${hook}`;
  return text.charCodeAt(index);
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? NaN : 97);
