/*---
description: A mapper can replace a previously known receiver before the later call.
features: [ts-proof-call-target, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions, ts-objects, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: map invokes a receiver-writing callback; node calls the replacement override.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterMap(n: number): number {
  const holder: { target: Base } = { target: new Base() };
  [0, 1].map(step => {
    if (step === n) holder.target = new Next();
    return step;
  });
  return holder.target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterMap(n), (n === 0 || n === 1 ? 200 : 100) + n);
}
