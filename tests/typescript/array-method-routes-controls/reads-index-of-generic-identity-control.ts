/*---
description: "indexOf searches from each supplied start without confusing equal-shaped objects with the sought reference. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-strings, ts-readonly]
---*/

function localIndexOf<T>(items: readonly T[], value: T, from: number = 0): number {
  if (from === Infinity) return -1;
  const whole = from !== from || from === -Infinity ? 0 : from - from % 1;
  let start = whole < 0 ? items.length + whole : whole;
  if (start < 0) start = 0;
  for (let index = start; index < items.length; index++) if (items[index] === value) return index;
  return -1;
}
// indexOf searches from each supplied start without confusing equal-shaped objects with the sought reference. Route: a constrained helper at string and record type arguments. Node prints reads-index-of-generic-identity:ok.
function inspect<T extends string | { id: number }>(first: T, second: T, missing: T): void {
  const items: readonly T[] = [first, second, first, second];
  const starts: readonly number[] = [0, 1, -2, 4], expected: readonly number[] = [0, 2, 2, -1];
  for (let i = 0; i < starts.length; i++) {
    const found = localIndexOf(items, first, starts[i]);
    assert.sameValue(found, expected[i]);
  }
  const absent = localIndexOf(items, missing);
  assert.sameValue(absent, -1);
}
inspect<string>("alpha", "beta", "missing");
const first = { id: 1 }, second = { id: 2 }, sameShape = { id: 1 };
inspect<{ id: number }>(first, second, sameShape);
console.log("reads-index-of-generic-identity:ok");
