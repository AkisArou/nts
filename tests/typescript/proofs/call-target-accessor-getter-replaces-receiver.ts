/*---
description: A getter can replace the receiver between its known allocation and its method call.
features: [ts-proof-call-target, ts-route-accessor, ts-functions, ts-iteration, ts-accessors, ts-objects, ts-class, ts-inheritance, ts-closures]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the property read runs a receiver writer; node calls its replacement.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterGetter(n: number): number {
  const holder: { target: Base } = { target: new Base() };
  const trigger = {
    get value(): number {
      if (n > 0) holder.target = new Next();
      return 0;
    }
  };
  const ignored = trigger.value;
  return holder.target.run(n + ignored);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterGetter(n), (n > 0 ? 200 : 100) + n);
}
