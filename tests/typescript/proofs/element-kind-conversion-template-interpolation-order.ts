/*---
description: Successive template interpolations observe the fact before and after the intervening conversion.
features: [ts-proof-element-kind, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-template-literals, ts-numbers]
---*/
// Fact: number[] starts with only integer elements (docs/foundations/objects.md, Arrays).
// Route: The middle toString changes the fact; node returns change > 0 ? "2:step:4294967296" : "2:step:2" with the before and after values in one literal.
function read(xs: number[]): number { return xs[1]; }
function observe(change: number) {
  const xs = [1, 2, 3];
  const gate = {
    toString(): string { if (change > 0) { xs.splice(1, 1, 4294967296); } return "step"; }
  };
  return `${read(xs)}:${gate}:${read(xs)}`;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result, change > 0 ? "2:step:4294967296" : "2:step:2");
}
