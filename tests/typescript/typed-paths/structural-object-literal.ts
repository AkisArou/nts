/*---
description: An object literal satisfies an interface structurally.
features: [ts-interfaces]
---*/
interface Point {
  x: number;
  y: number;
}
function length2(p: Point): number {
  return p.x * p.x + p.y * p.y;
}
assert.sameValue(length2({ x: 3, y: 4 }), 25);
