/*---
description: An interface extending a class takes its public members; an object literal or a subclass satisfies it.
features: [ts-interfaces, ts-interface-extends, ts-class]
---*/
class Point2 {
  constructor(public x: number, public y: number) {}
}
interface Point3 extends Point2 {
  z: number;
}
function sum(p: Point3): number {
  return p.x + p.y + p.z;
}
class Voxel extends Point2 implements Point3 {
  z = 3;
}
assert.sameValue(sum({ x: 1, y: 2, z: 3 }), 6);
assert.sameValue(sum(new Voxel(10, 20)), 33);
