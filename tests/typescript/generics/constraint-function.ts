/*---
description: A type parameter constrained to a function type is called, and returned as the function it was given.
features: [ts-generics, ts-generic-constraints, ts-function-types]
---*/
function applyTwice<T extends (n: number) => number>(f: T, start: number): number {
  return f(f(start));
}
function logged<T extends (n: number) => number>(f: T, calls: number[]): T {
  calls.push(f(0));
  return f;
}
const increment = (n: number): number => n + 1;
assert.sameValue(applyTwice(increment, 5), 7);
assert.sameValue(applyTwice((n) => n * n, 3), 81);
const calls: number[] = [];
assert.sameValue(logged(increment, calls), increment);
assert.compareArray(calls, [1]);
