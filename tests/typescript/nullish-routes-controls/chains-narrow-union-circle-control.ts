/*---
description: "A discriminated union narrows through an optional property chain. Route: circle-square union (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// A discriminated union narrows through an optional property chain. Route: circle-square union. Node prints chains-narrow-union-circle:ok.
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
function area(shape: Shape | undefined): number {
  const first = shape;
  if (first !== null && first !== undefined && first.kind === "circle") return first.radius * first.radius;
  const second = shape;
  if (second !== null && second !== undefined && second.kind === "square") return second.side * second.side;
  return 0;
}
assert.sameValue(area(undefined), 0);
assert.sameValue(area({ kind: "circle", radius: 2 }), 4);
assert.sameValue(area({ kind: "square", side: 3 }), 9);
console.log("chains-narrow-union-circle:ok");
