/*---
description: Successive template interpolations observe the fact before and after the intervening conversion.
features: [ts-proof-length, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-template-literals]
---*/
// Fact: the literal allocation has length 3 (docs/foundations/objects.md, Arrays).
// Route: The middle toString changes the fact; node returns change > 0 ? "3:step:0" : "3:step:3" with the before and after values in one literal.
function observe(change: number) {
  const xs = [1, 2, 3];
  const gate = {
    toString(): string { if (change > 0) { xs.length = 0; } return "step"; }
  };
  return `${xs.length}:${gate}:${xs.length}`;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result, change > 0 ? "3:step:0" : "3:step:3");
}
