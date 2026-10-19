/*---
description: `typeof` of a function and of a class types variables that hold that function and constructor values.
features: [ts-type-operators, ts-typeof-type, ts-class, ts-utility-types]
---*/
function area(w: number, h: number): number {
  return w * h;
}
class Shape {
  constructor(readonly sides: number) {}
}
class Triangle extends Shape {
  constructor() {
    super(3);
  }
}
const measure: typeof area = (a, b) => a + b;
const Kind: typeof Shape = Triangle;
const made: InstanceType<typeof Shape> = new Kind(0);
assert.sameValue(measure(2, 3), 5);
assert.sameValue(made.sides, 3);
assert.sameValue(made instanceof Triangle, true);
