/*---
description: A function replaced in the update clause changes the sign of a loop-carried zero.
features: [ts-proof-negative-zero, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-destructuring, ts-objects, ts-closures, ts-numbers]
---*/
// Fact: the initial literal is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the update-clause destructuring installs the writer for later body calls; node observes its effect.
function observe(turns: number): number {
  let value = 0;
  let action: () => void = () => { value *= 1; };
  const flip = (): void => { value *= -1; };
  for (let i = 0; i < turns; i++, ({ action } = { action: flip })) {
    action();
  }
  return 1 / value;
}
for (const n of [0, 1, 2, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 1 && n % 2 === 0 ? -Infinity : Infinity);
}
