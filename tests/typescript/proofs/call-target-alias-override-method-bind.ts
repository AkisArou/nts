/*---
description: An alias replaces an extracted override and its original receiver before binding.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-iteration, ts-objects, ts-class, ts-inheritance, ts-override, ts-this]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the paired field stores preserve the extraction receiver; node binds the new override.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterAlias(n: number): number {
  const first = new Base();
  const holder: { receiver: Base; action: (n: number) => number } = {
    receiver: first, action: first.run
  };
  const alias = holder;
  if (n > 0) {
    const second = new Next();
    alias.receiver = second;
    alias.action = second.run;
  }
  const bound = holder.action.bind(holder.receiver, n);
  return bound();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), (n > 0 ? 200 : 100) + n);
}
