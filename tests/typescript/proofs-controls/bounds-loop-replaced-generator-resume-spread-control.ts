/*---
description: Control. Remove only the target replacement after yield.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-generators, ts-rest-parameters, ts-spread, ts-arrays, ts-closures]
---*/
// Control: paired with proofs/bounds-loop-replaced-generator-resume-spread.ts. Remove only the target replacement after yield.
// Fact: an allocation proves the index in range (docs/foundations/objects.md, Arrays).
// Route: after yielding, the generator installs a new rest target; the next loop visit invokes it with spread arguments.
function* observations(turns: number): Generator<number, void, unknown> {
  const xs = [11, 22, 33];
  const index = 2;
  if (index >= xs.length) return;
  let action: (...items: number[]) => void = (...items): void => { xs[index] = items[0]; };
  const append = (...items: number[]): void => {
    xs.pop();
    xs[index] = items[0] + 1;
  };
  const args = [33];
  for (let i = 0; i < turns; i++) {
    action(...args);
    yield 100 * xs.length + xs[index];
  }
}

function observe(turns: number): number {
  let result = 333;
  for (const value of observations(turns)) result = value;
  return result;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), 333);
}
