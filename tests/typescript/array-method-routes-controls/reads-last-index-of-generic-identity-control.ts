/*---
description: "lastIndexOf retains reference equality and finds the final eligible occurrence at each supplied start. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-strings, ts-readonly]
---*/

function localLastIndexOf<T>(items: readonly T[], value: T, ...from: (number | undefined)[]): number {
  const supplied = from[0], input = from.length === 0 ? items.length - 1 : supplied === undefined ? 0 : supplied;
  if (input === -Infinity) return -1;
  const whole = input !== input ? 0 : input === Infinity ? items.length - 1 : input - input % 1;
  let start = whole < 0 ? items.length + whole : whole;
  if (start >= items.length) start = items.length - 1;
  for (let index = start; index >= 0; index--) if (items[index] === value) return index;
  return -1;
}
// lastIndexOf retains reference equality and finds the final eligible occurrence at each supplied start. Route: a constrained helper at string and record type arguments. Node prints reads-last-index-of-generic-identity:ok.
function inspect<T extends string | { id: number }>(first: T, second: T, missing: T): void {
  const items: readonly T[] = [first, second, first, second];
  const starts: readonly number[] = [0, 1, -2, 4, -10], expected: readonly number[] = [0, 0, 2, 2, -1];
  for (let i = 0; i < starts.length; i++) {
    const found = localLastIndexOf(items, first, starts[i]);
    assert.sameValue(found, expected[i]);
  }
  const final = localLastIndexOf(items, first), absent = localLastIndexOf(items, missing);
  assert.sameValue(final, 2); assert.sameValue(absent, -1);
}
inspect<string>("alpha", "beta", "missing");
const first = { id: 1 }, second = { id: 2 }, sameShape = { id: 1 };
inspect<{ id: number }>(first, second, sameShape);
console.log("reads-last-index-of-generic-identity:ok");
