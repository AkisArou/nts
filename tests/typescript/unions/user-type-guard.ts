/*---
description: A user-defined type guard narrows its argument in the branch where it returned true.
features: [ts-unions, ts-narrowing, ts-type-guards]
---*/
type Square = { side: number };
type Circle = { radius: number };
function isSquare(shape: Square | Circle): shape is Square {
  return (shape as Square).side !== undefined;
}
function area(shape: Square | Circle): number {
  if (isSquare(shape)) return shape.side * shape.side;
  return 3 * shape.radius * shape.radius;
}
assert.sameValue(area({ side: 3 }), 9);
assert.sameValue(area({ radius: 2 }), 12);
