/*---
description: A generator carries a replacement function whose spread operands make a finite integer infinite.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-generators, ts-rest-parameters, ts-spread, ts-arrays, ts-closures, ts-numbers]
---*/
// Fact: the initial literal is a whole finite integer (docs/foundations/numbers.md, Integers proved from doubles).
// Route: after yielding, the generator installs a new rest target; the next loop visit invokes it with spread arguments.
function* observations(turns: number): Generator<number, void, unknown> {
  let value = 0;
  let action: (...parts: number[]) => void = (...parts): void => { value += parts[0] - parts[1]; };
  const divide = (...parts: number[]): void => { value = parts[0] / (parts[0] - parts[1]); };
  const args = [1, 1];
  for (let i = 0; i < turns; i++) {
    action(...args);
    yield value;
    action = divide;
  }
}

function observe(turns: number): number {
  let result = 0;
  for (const value of observations(turns)) result = value;
  return result;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 0 : Infinity);
}
