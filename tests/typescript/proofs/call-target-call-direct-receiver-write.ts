/*---
description: A direct called writer replaces the known receiver before the caller dispatches.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-iteration, ts-objects, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the direct call writes the receiver field; node calls the replacement override.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }
function replace(holder: { target: Base }, n: number): void {
  if (n > 0) holder.target = new Next();
}
function afterCall(n: number): number {
  const holder: { target: Base } = { target: new Base() };
  replace(holder, n);
  return holder.target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCall(n), (n > 0 ? 200 : 100) + n);
}
