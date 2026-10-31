/*---
description: Destructuring in a for update clause changes the function called by the next body visit.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-destructuring, ts-objects]
---*/
// Fact: the initial function value has one known implementation (docs/foundations/objects.md, Calls).
// Route: the update clause replaces first with second; node invokes second after the first back edge.
function first(value: number): number { return 100 + value; }
function second(value: number): number { return 200 + 2 * value; }
function observe(turns: number): number {
  let action: (value: number) => number = first;
  let result = 100 + turns;
  for (let i = 0; i < turns; i++, ({ action } = { action: second })) {
    result = action(turns);
  }
  return result;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 100 + n : 200 + 2 * n);
}
