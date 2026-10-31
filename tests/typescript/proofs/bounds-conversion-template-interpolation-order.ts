/*---
description: Template interpolation keeps a valid index while conversion moves the element it reads.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-template-literals]
---*/
// Fact: index 1 is below the literal length and survives a shift (docs/foundations/objects.md, Arrays).
// Route: The middle toString shifts the array; node returns 22:step:33 after a change and 22:step:22 otherwise.
function observe(change: number) {
  const xs = [11, 22, 33, 44];
  const index = 1;
  const gate = {
    toString(): string { if (change > 0) xs.shift(); return "step"; }
  };
  if (index < xs.length) return `${xs[index]}:${gate}:${xs[index]}`;
  return "guard failed";
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result, change > 0 ? "22:step:33" : "22:step:22");
}
