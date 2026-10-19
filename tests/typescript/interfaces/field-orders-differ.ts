/*---
description: Classes implementing one interface declare its fields in different orders; reads through the interface find each by name.
features: [ts-interfaces, ts-class]
---*/
interface Point {
  x: number;
  y: number;
}
class XY implements Point {
  x = 1;
  y = 2;
}
class YX implements Point {
  y = 20;
  x = 10;
}
class Extra implements Point {
  label = "p";
  y = 200;
  z = 0;
  x = 100;
}
function difference(p: Point): number {
  return p.x - p.y;
}
const points: Point[] = [new XY(), new YX(), new Extra()];
assert.sameValue(points.map(difference).join(","), "-1,-10,-100");
