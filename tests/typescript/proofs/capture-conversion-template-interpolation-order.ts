/*---
description: Successive template interpolations observe the fact before and after the intervening conversion.
features: [ts-proof-capture, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-template-literals, ts-arrow-functions, ts-function-types]
---*/
// Fact: the reader is created before any write to its binding (docs/foundations/objects.md, Functions as values).
// Route: The middle toString changes the fact; node returns `10:step:${change > 0 ? 10 + change : 10}` with the before and after values in one literal.
function observe(change: number) {
  let value = 10;
  const read = (): number => value;
  const gate = {
    toString(): string { if (change > 0) { value = 10 + change; } return "step"; }
  };
  return `${read()}:${gate}:${read()}`;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result, `10:step:${change > 0 ? 10 + change : 10}`);
}
