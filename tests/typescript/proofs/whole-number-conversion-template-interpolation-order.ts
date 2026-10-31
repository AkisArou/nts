/*---
description: Successive template interpolations observe the fact before and after the intervening conversion.
features: [ts-proof-whole-number, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-template-literals, ts-numbers]
---*/
// Fact: the initial literal is a safe integer (docs/foundations/numbers.md, Integers proved from doubles).
// Route: The middle toString changes the fact; node returns change > 0 ? "1:step:0" : "1:step:1" with the before and after values in one literal.
function observe(change: number) {
  let value = 9007199254740991;
  const gate = {
    toString(): string { if (change > 0) { value = 9007199254740992; } return "step"; }
  };
  return `${(value + 1) - value}:${gate}:${(value + 1) - value}`;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result, change > 0 ? "1:step:0" : "1:step:1");
}
