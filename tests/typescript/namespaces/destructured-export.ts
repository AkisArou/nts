/*---
description: An exported destructuring declaration exports each name it binds.
features: [ts-namespace, ts-destructuring]
---*/
namespace Point {
  export const { x, y } = { x: 3, y: 4 };
  export const [first, second] = [5, 6];
}
assert.sameValue(Point.x + Point.y, 7);
assert.sameValue(Point.first * Point.second, 30);
