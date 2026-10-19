/*---
description: A value typed as a union of array types is narrowed by inspecting an element.
features: [ts-unions, ts-narrowing]
---*/
function total(values: number[] | string[]): number {
  if (values.length === 0) return 0;
  const head = values[0];
  if (typeof head === "number") return (values as number[]).reduce((a, b) => a + b, 0);
  return (values as string[]).join("").length;
}
assert.sameValue(total([1, 2, 3]), 6);
assert.sameValue(total(["ab", "c"]), 3);
assert.sameValue(total([]), 0);
