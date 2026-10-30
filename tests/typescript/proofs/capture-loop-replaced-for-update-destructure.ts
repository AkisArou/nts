/*---
description: A writer installed by update-clause destructuring updates the binding held by an earlier closure.
features: [ts-proof-capture, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-destructuring, ts-objects, ts-closures]
---*/
// Fact: a read closure initially captures an unwritten binding (docs/foundations/objects.md, Functions as values).
// Route: the update-clause destructuring installs the writer for later body calls; node observes its effect.
function observe(turns: number): number {
  let value = 10;
  const read = (): number => value;
  let action: () => void = () => {};
  const write = (): void => { value += 2; };
  for (let i = 0; i < turns; i++, ({ action } = { action: write })) {
    action();
  }
  return read();
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 10 : 10 + 2 * (n - 1));
}
