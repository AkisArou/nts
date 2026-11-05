/*---
description: "includes retains generic object identity and obeys the eligible suffix selected by each offset."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-strings, ts-objects, ts-readonly]
---*/

// includes retains generic object identity and obeys the eligible suffix selected by each offset. Route: a constrained helper at string and record type arguments. Node prints reads-includes-generic-identity:ok.
function inspect<T extends string | { id: number }>(first: T, second: T, missing: T): void {
  const items: readonly T[] = [first, second, first];
  const starts: readonly number[] = [0, 1, -1, 3], expected: readonly boolean[] = [true, true, true, false];
  for (let i = 0; i < starts.length; i++) {
    const found = items.includes(first, starts[i]);
    assert.sameValue(found, expected[i]);
  }
  const excluded = items.includes(second, -1), absent = items.includes(missing);
  assert.sameValue(excluded, false); assert.sameValue(absent, false);
}
inspect<string>("alpha", "beta", "missing");
const first = { id: 1 }, second = { id: 2 }, sameShape = { id: 1 };
inspect<{ id: number }>(first, second, sameShape);
console.log("reads-includes-generic-identity:ok");
