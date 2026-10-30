/*---
description: A generator resumes with a replaced rest function and forwards the whole spread argument list.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-generators, ts-rest-parameters, ts-spread, ts-arrays]
---*/
// Fact: the initial function value has one known implementation (docs/foundations/objects.md, Calls).
// Route: after yielding, the generator installs a new rest target; the next loop visit invokes it with spread arguments.
function first(...values: number[]): number {
  let result = 100;
  for (const value of values) result += value;
  return result;
}
function second(...values: number[]): number {
  let result = 200;
  for (const value of values) result += 3 * value;
  return result;
}
function* observations(turns: number): Generator<number, void, unknown> {
  let action: (...values: number[]) => number = first;
  const args = [turns, 2];
  for (let i = 0; i < turns; i++) {
    yield action(...args);
    action = second;
  }
}

function observe(turns: number): number {
  let result = 102 + turns;
  for (const value of observations(turns)) result = value;
  return result;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 102 + n : 206 + 3 * n);
}
