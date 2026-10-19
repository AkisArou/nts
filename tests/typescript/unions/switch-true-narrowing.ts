/*---
description: `switch (true)` with typeof cases narrows the value in each arm.
features: [ts-unions, ts-narrowing]
---*/
function weigh(value: string | number | boolean): number {
  switch (true) {
    case typeof value === "string":
      return value.length;
    case typeof value === "number":
      return value;
    default:
      return value ? 1 : 0;
  }
}
assert.sameValue(weigh("four"), 4);
assert.sameValue(weigh(2.5), 2.5);
assert.sameValue(weigh(true), 1);
