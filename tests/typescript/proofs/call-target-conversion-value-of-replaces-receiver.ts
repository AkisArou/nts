/*---
description: Numeric conversion can replace a known receiver through valueOf before its call.
features: [ts-proof-call-target, ts-route-conversion, ts-functions, ts-iteration, ts-conversions, ts-to-primitive, ts-objects, ts-class, ts-inheritance, ts-closures]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: Number runs valueOf between allocation and use; node calls the replacement override.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterConversion(n: number): number {
  const holder: { target: Base } = { target: new Base() };
  const trigger = {
    valueOf(): number {
      if (n > 0) holder.target = new Next();
      return 0;
    }
  };
  const ignored = Number(trigger);
  return holder.target.run(n + ignored);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), (n > 0 ? 200 : 100) + n);
}
