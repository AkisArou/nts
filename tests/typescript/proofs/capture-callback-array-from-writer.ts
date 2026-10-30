/*---
description: Array.from invokes a mapper that writes the binding held by its sibling reader.
features: [ts-proof-capture, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-arrays, ts-objects]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: each map call writes the shared binding; node sees count after the last one.
function afterFrom(count: number): number {
  let value = 0;
  const read = (): number => value;
  Array.from({ length: count }, (_, index) => {
    value = index + 1;
    return index;
  });
  return read();
}
for (const n of [0, 1, 2, 3, 7]) assert.sameValue(afterFrom(n), n);
