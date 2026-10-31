/*---
description: A rest function replaced after a yield writes the binding observed by a previously created closure.
features: [ts-proof-capture, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-generators, ts-rest-parameters, ts-spread, ts-arrays, ts-closures]
---*/
// Fact: a read closure initially captures an unwritten binding (docs/foundations/objects.md, Functions as values).
// Route: after yielding, the generator installs a new rest target; the next loop visit invokes it with spread arguments.
function* observations(turns: number): Generator<number, void, unknown> {
  let value = 10;
  const read = (): number => value;
  let action: (...parts: number[]) => void = () => {};
  const write = (...parts: number[]): void => { value += parts[0]; };
  const args = [3];
  for (let i = 0; i < turns; i++) {
    action(...args);
    yield read();
    action = write;
  }
}

function observe(turns: number): number {
  let result = 10;
  for (const value of observations(turns)) result = value;
  return result;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 10 : 10 + 3 * (n - 1));
}
