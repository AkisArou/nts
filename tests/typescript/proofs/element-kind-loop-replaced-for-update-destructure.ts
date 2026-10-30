/*---
description: An update-clause function replacement introduces fractions into an initially integral array.
features: [ts-proof-element-kind, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-destructuring, ts-objects, ts-closures, ts-arrays, ts-numbers]
---*/
// Fact: the initial number arrays hold only small integers (docs/foundations/objects.md, Arrays).
// Route: the update-clause destructuring installs the writer for later body calls; node observes its effect.
function readFirst(xs: number[]): number { return xs[0]; }
function observe(turns: number): number {
  const xs = [6];
  let action: () => void = () => { xs[0] += 1; };
  const halve = (): void => { xs[0] /= 2; };
  for (let i = 0; i < turns; i++, ({ action } = { action: halve })) {
    action();
  }
  return readFirst(xs);
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n === 0 ? 6 : 7 / 2 ** (n - 1));
}
