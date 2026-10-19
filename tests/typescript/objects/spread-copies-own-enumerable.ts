/*---
description: Spreading a class instance copies its own fields but not its prototype's methods or accessors.
features: [ts-objects, ts-spread, ts-class]
---*/
class Point {
  constructor(public x: number, public y: number) {}
  get sum(): number {
    return this.x + this.y;
  }
  norm(): number {
    return Math.abs(this.x) + Math.abs(this.y);
  }
}
const copy = { ...new Point(1, -2) };
assert.sameValue(Object.keys(copy).join(","), "x,y");
assert.sameValue("sum" in copy, false);
assert.sameValue("norm" in copy, false);
assert.sameValue(copy.x + copy.y, -1);
