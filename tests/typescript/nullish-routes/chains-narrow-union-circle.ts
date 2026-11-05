/*---
description: "A discriminated union narrows through an optional property chain. Route: circle-square union"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// A discriminated union narrows through an optional property chain. Route: circle-square union. Node prints chains-narrow-union-circle:ok.
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
function area(shape: Shape | undefined): number {
  if (shape?.kind === "circle") return shape.radius * shape.radius;
  if (shape?.kind === "square") return shape.side * shape.side;
  return 0;
}
assert.sameValue(area(undefined), 0);
assert.sameValue(area({ kind: "circle", radius: 2 }), 4);
assert.sameValue(area({ kind: "square", side: 3 }), 9);
console.log("chains-narrow-union-circle:ok");
