/*---
description: "includes retains generic object identity and obeys the eligible suffix selected by each offset. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-strings, ts-objects, ts-readonly]
---*/

function localIncludes<T>(items: readonly T[], value: T, from: number = 0): boolean {
  if (from === Infinity) return false;
  const whole = from !== from || from === -Infinity ? 0 : from - from % 1;
  let start = whole < 0 ? items.length + whole : whole;
  if (start < 0) start = 0;
  for (let index = start; index < items.length; index++) {
    const item = items[index]; if (item === value || item !== item && value !== value) return true;
  }
  return false;
}
// includes retains generic object identity and obeys the eligible suffix selected by each offset. Route: a constrained helper at string and record type arguments. Node prints reads-includes-generic-identity:ok.
function inspect<T extends string | { id: number }>(first: T, second: T, missing: T): void {
  const items: readonly T[] = [first, second, first];
  const starts: readonly number[] = [0, 1, -1, 3], expected: readonly boolean[] = [true, true, true, false];
  for (let i = 0; i < starts.length; i++) {
    const found = localIncludes(items, first, starts[i]);
    assert.sameValue(found, expected[i]);
  }
  const excluded = localIncludes(items, second, -1), absent = localIncludes(items, missing);
  assert.sameValue(excluded, false); assert.sameValue(absent, false);
}
inspect<string>("alpha", "beta", "missing");
const first = { id: 1 }, second = { id: 2 }, sameShape = { id: 1 };
inspect<{ id: number }>(first, second, sameShape);
console.log("reads-includes-generic-identity:ok");
