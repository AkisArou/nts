/*---
description: A class instance is assigned to an object type with the same members, and reads through it reach the instance.
features: [ts-objects, ts-structural-typing, ts-class]
---*/
class Vector {
  constructor(public x: number, public y: number) {}
  length(): number {
    return Math.hypot(this.x, this.y);
  }
}
type VectorLike = { x: number; y: number; length(): number };
const plain: VectorLike = new Vector(3, 4);
assert.sameValue(plain.length(), 5);
plain.x = 6;
plain.y = 8;
assert.sameValue(plain.length(), 10);
assert.sameValue(plain instanceof Vector, true);
