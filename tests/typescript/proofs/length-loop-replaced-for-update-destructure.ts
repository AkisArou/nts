/*---
description: A function replaced in the for update clause grows an allocation on later iterations.
features: [ts-proof-length, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-destructuring, ts-objects, ts-closures, ts-arrays]
---*/
// Fact: the literal allocation proves its length (docs/foundations/objects.md, Arrays).
// Route: the update-clause destructuring installs the writer for later body calls; node observes its effect.
function observe(turns: number): number {
  const xs = [10, 20];
  let action: () => void = () => {};
  const append = (): void => { xs.push(30); };
  for (let i = 0; i < turns; i++, ({ action } = { action: append })) {
    action();
  }
  return xs.length;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 2 : n + 1);
}
