/*---
description: A closure writes a captured owner alias before the original field is dispatched.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-iteration, ts-closures, ts-objects, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the captured alias changes the receiver field; node runs the replacement override.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterAlias(n: number): number {
  const holder: { target: Base } = { target: new Base() };
  const alias = holder;
  const replace = (): void => { if (n > 0) alias.target = new Next(); };
  replace();
  return holder.target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), (n > 0 ? 200 : 100) + n);
}
