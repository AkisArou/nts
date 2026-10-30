/*---
description: A generator-carried replacement stores negative zero derived from integral spread input.
features: [ts-proof-element-kind, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-generators, ts-rest-parameters, ts-spread, ts-arrays, ts-closures, ts-numbers]
---*/
// Fact: the initial number arrays hold only small integers (docs/foundations/objects.md, Arrays).
// Route: after yielding, the generator installs a new rest target; the next loop visit invokes it with spread arguments.
function readLast(xs: number[]): number { return 1 / xs[xs.length - 1]; }
function* observations(turns: number): Generator<number, void, unknown> {
  const xs = [3];
  let action: (...items: number[]) => void = (...items): void => { xs.push(items[0]); };
  const negate = (...items: number[]): void => { xs.push(-items[0]); };
  const args = [0];
  for (let i = 0; i < turns; i++) {
    action(...args);
    yield readLast(xs);
    action = negate;
  }
}

function observe(turns: number): number {
  let result = 1 / 3;
  for (const value of observations(turns)) result = value;
  return result;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n === 0 ? 1 / 3 : n === 1 ? Infinity : -Infinity);
}
