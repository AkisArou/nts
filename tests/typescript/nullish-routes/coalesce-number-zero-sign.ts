/*---
description: "Generic numeric coalescing preserves negative zero and NaN. Route: generic number parameter"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-generics, ts-numbers]
---*/

// Generic numeric coalescing preserves negative zero and NaN. Route: generic number parameter. Node prints coalesce-number-zero-sign:ok.
function select<T>(value: T | null | undefined, fallback: T): T {
  const result = value ?? fallback;
  return result;
}
const rows: readonly (readonly [number | null | undefined, number])[] = [[-0, -0], [0, 0], [NaN, NaN], [null, 5], [undefined, 5], [9, 9]];
for (const [value, expected] of rows) assert.sameValue(select<number>(value, 5), expected);
console.log("coalesce-number-zero-sign:ok");
