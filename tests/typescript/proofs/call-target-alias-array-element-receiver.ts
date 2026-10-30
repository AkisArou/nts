/*---
description: An array alias replaces the element later used as a receiver.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: an element store through the alias replaces Base; node calls Next.run.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterAlias(n: number): number {
  const targets: Base[] = [new Base()];
  const alias = targets;
  if (n > 0) alias[0] = new Next();
  return targets[0].run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), (n > 0 ? 200 : 100) + n);
}
