/*---
description: A namespace merged with a class adds static members to it.
features: [ts-namespace, ts-declaration-merging, ts-class]
---*/
class Point {
  constructor(public x: number) {}
}
namespace Point {
  export const origin = new Point(0);
}
assert.sameValue(Point.origin.x, 0);
assert.sameValue(new Point(3).x, 3);
