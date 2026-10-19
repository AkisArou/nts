/*---
description: JSON.stringify calls a class's toJSON and serialises what it returns.
features: [ts-conversions, ts-class]
---*/
class Point {
  constructor(private x: number, private y: number) {}
  toJSON(): [number, number] {
    return [this.x, this.y];
  }
}
class Path {
  constructor(readonly label: string, readonly points: Point[]) {}
}
const path = new Path("p", [new Point(1, 2), new Point(3, 4)]);
assert.sameValue(JSON.stringify(path), '{"label":"p","points":[[1,2],[3,4]]}');
assert.sameValue(JSON.stringify(new Point(0, -0)), "[0,0]");
