/*---
description: A discriminant field narrows a union of object types.
features: [ts-unions, ts-narrowing]
---*/
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return 3 * shape.radius * shape.radius;
    case "square":
      return shape.side * shape.side;
  }
}
assert.sameValue(area({ kind: "circle", radius: 2 }), 12);
assert.sameValue(area({ kind: "square", side: 3 }), 9);
