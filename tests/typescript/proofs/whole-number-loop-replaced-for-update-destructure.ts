/*---
description: A function installed by update-clause destructuring divides the initially whole value.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-destructuring, ts-objects, ts-closures, ts-numbers]
---*/
// Fact: the initial literal is a whole finite integer (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the update-clause destructuring installs the writer for later body calls; node observes its effect.
function observe(turns: number): number {
  let value = 7;
  let action: () => void = () => { value += 0; };
  const halve = (): void => { value /= 2; };
  for (let i = 0; i < turns; i++, ({ action } = { action: halve })) {
    action();
  }
  return value;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 7 : 7 / 2 ** (n - 1));
}
