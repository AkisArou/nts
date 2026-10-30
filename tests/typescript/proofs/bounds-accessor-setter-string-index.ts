/*---
description: A setter changes the string index; charAt gives an empty string.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects, ts-strings, ts-closures]
---*/
// docs/foundations/objects.md, Arrays: index 0 initially lies inside the string literal.
// A setter changes the string index; charAt gives an empty string.
function read(change: number): string {
  const text = "abcd";
  let index = 0;
  const hook = { set effect(n: number) { if (n > 0) index = 4; } };
  hook.effect = change;
  return text.charAt(index);
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? "" : "a");
