/*---
description: A rest target replaced between generator yields produces a zero sign visible through Math.max.
features: [ts-proof-negative-zero, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-generators, ts-rest-parameters, ts-spread, ts-arrays, ts-closures, ts-numbers]
---*/
// Fact: the initial literal is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: after yielding, the generator installs a new rest target; the next loop visit invokes it with spread arguments.
function* observations(turns: number): Generator<number, void, unknown> {
  let value = 0;
  let action: (...parts: number[]) => void = (...parts): void => { value = Math.abs(parts[0]); };
  const negate = (...parts: number[]): void => { value = -parts[0]; };
  const args = [0];
  for (let i = 0; i < turns; i++) {
    action(...args);
    yield 1 / Math.max(-0, value);
    action = negate;
  }
}

function observe(turns: number): number {
  let result = Infinity;
  for (const value of observations(turns)) result = value;
  return result;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? Infinity : -Infinity);
}
