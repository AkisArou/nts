/*---
description: A type parameter constrained to number is used with arithmetic, and a literal argument keeps its value.
features: [ts-generics, ts-generic-constraints]
---*/
function largest<T extends number>(values: T[]): T {
  let best = values[0];
  for (const value of values) if (value > best) best = value;
  return best;
}
function scaled<T extends number>(value: T, factor: number): number {
  return value * factor;
}
const sizes: (1 | 2 | 3)[] = [2, 3, 1];
const biggest: 1 | 2 | 3 = largest(sizes);
assert.sameValue(biggest, 3);
assert.sameValue(largest([0.5, -1, 0.25]), 0.5);
assert.sameValue(scaled(biggest, 1.5), 4.5);
