/*---
description: Successive template interpolations observe the fact before and after the intervening conversion.
features: [ts-proof-call-target, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-template-literals, ts-class, ts-inheritance, ts-override]
---*/
// Fact: new Base establishes the receiver class (docs/foundations/objects.md, Calls).
// Route: The middle toString changes the fact; node returns `${100 + change}:step:${(change > 0 ? 200 : 100) + change}` with the before and after values in one literal.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }
function observe(change: number) {
  let target: Base = new Base();
  const gate = {
    toString(): string { if (change > 0) { target = new Next(); } return "step"; }
  };
  return `${target.run(change)}:${gate}:${target.run(change)}`;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result, `${100 + change}:step:${(change > 0 ? 200 : 100) + change}`);
}
