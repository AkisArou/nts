/*---
description: An object alias replaces a declared closure-valued field before the call.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-iteration, ts-objects, ts-closures, ts-function-types]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the field alias changes the closure class; node calls the newly stored body.
function afterAlias(n: number): number {
  const base = n + 100;
  const holder: { action: () => number } = { action: () => base };
  const alias = holder;
  if (n > 0) alias.action = () => base + 100;
  return holder.action();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), (n > 0 ? 200 : 100) + n);
}
