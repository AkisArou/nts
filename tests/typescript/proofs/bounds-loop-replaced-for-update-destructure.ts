/*---
description: A function replaced by update-clause destructuring removes a formerly in-range last slot.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-destructuring, ts-objects, ts-closures, ts-arrays, ts-null-undefined]
---*/
// Fact: an allocation proves the index in range (docs/foundations/objects.md, Arrays).
// Route: the update-clause destructuring installs the writer for later body calls; node observes its effect.
function observe(turns: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const index = 3;
  let action: () => void = () => {};
  const shrink = (): void => { xs.pop(); };
  for (let i = 0; i < turns; i++, ({ action } = { action: shrink })) {
    action();
  }
  return xs[index];
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 44 : undefined);
}
