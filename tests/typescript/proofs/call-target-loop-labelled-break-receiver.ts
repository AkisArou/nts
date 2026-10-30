/*---
description: A labelled break retains the receiver installed by earlier nested-loop iterations.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the labelled exit carries the latest target; node uses Next after any update.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function atBreak(stop: number): number {
  let target: Base = new Base();
  outer: for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      if (row * 3 + column === stop) break outer;
      target = new Next();
    }
  }
  return target.run(stop);
}
for (const n of [0, 1, 3, 4, 7, 9]) {
  assert.sameValue(atBreak(n), (n === 0 ? 100 : 200) + n);
}
