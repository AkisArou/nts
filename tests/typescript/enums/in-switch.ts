/*---
description: A switch over an enum value takes the member's arm.
features: [ts-enum]
---*/
enum Shape { Circle, Square, Triangle }
function sides(shape: Shape): number {
  switch (shape) {
    case Shape.Circle:
      return 0;
    case Shape.Square:
      return 4;
    case Shape.Triangle:
      return 3;
  }
}
assert.sameValue(sides(Shape.Square), 4);
assert.sameValue(sides(Shape.Triangle), 3);
assert.sameValue(sides(Shape.Circle), 0);
