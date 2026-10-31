/*---
description: A function replaced between generator yields appends all of its spread arguments.
features: [ts-proof-length, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-generators, ts-rest-parameters, ts-spread, ts-arrays, ts-closures]
---*/
// Fact: the literal allocation proves its length (docs/foundations/objects.md, Arrays).
// Route: after yielding, the generator installs a new rest target; the next loop visit invokes it with spread arguments.
function* observations(turns: number): Generator<number, void, unknown> {
  const xs = [10, 20];
  let action: (...items: number[]) => void = (...items): void => { xs[0] = items[0]; };
  const append = (...items: number[]): void => { xs.push(...items); };
  const args = [30, 40];
  for (let i = 0; i < turns; i++) {
    action(...args);
    yield xs.length;
    action = append;
  }
}

function observe(turns: number): number {
  let result = 2;
  for (const value of observations(turns)) result = value;
  return result;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 2 : 2 * n);
}
