/*---
description: Successive template interpolations observe the fact before and after the intervening conversion.
features: [ts-proof-negative-zero, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-template-literals, ts-numbers]
---*/
// Fact: the literal value is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: The middle toString changes the fact; node returns change > 0 ? "Infinity:step:-Infinity" : "Infinity:step:Infinity" with the before and after values in one literal.
function observe(change: number) {
  let value = 0;
  const gate = {
    toString(): string { if (change > 0) { value = -0; } return "step"; }
  };
  return `${1 / value}:${gate}:${1 / value}`;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result, change > 0 ? "Infinity:step:-Infinity" : "Infinity:step:Infinity");
}
