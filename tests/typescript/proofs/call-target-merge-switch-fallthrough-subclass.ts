/*---
description: A switch fall-through replaces the previously known receiver class.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-override]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: fall-through installs Last after Next; node must run Last.run.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

class Last extends Base { override run(n: number): number { return 300 + n; } }
function afterSwitch(n: number): number {
  let target: Base = new Base();
  switch (n) {
    case 0: target = new Next(); break;
    case 1: target = new Next();
    case 2: target = new Last(); break;
  }
  return target.run(n);
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterSwitch(n), (n === 0 ? 200 : n === 1 || n === 2 ? 300 : 100) + n);
}
