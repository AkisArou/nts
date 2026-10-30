/*---
description: An intervening call replaces an override target and supplies its fractional argument.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-override, ts-numbers, ts-objects]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the callee changes both target and argument facts; node preserves the fractional override call.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function replace(holder: { target: Base }, n: number): number {
  if (n <= 0) return n | 0;
  holder.target = new Next();
  return n + 0.5;
}
function afterCall(n: number): number {
  const holder: { target: Base } = { target: new Base() };
  const value = replace(holder, n);
  return holder.target.run(value);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCall(n), n > 0 ? 200.5 + n : 100 + n);
}
