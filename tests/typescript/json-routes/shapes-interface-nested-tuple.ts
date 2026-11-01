/*---
description: A tuple field inside an interface preserves both coordinates and the surrounding object order.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-objects, ts-tuples, ts-arrays, ts-numbers, ts-strings]
---*/
// Parse a matching interface with a numeric tuple field; node retains coordinate signs, fractions and the label.
interface JsonPosition { point: [number, number]; label: string; }
function check(text: string, x: number, y: number, label: string): void {
  const value: JsonPosition = JSON.parse(text);
  assert.sameValue(typeof value, "object");
  if (typeof value !== "object" || value === null || !("point" in value) || !("label" in value) || !Array.isArray(value.point)) throw new Error("position");
  assert.compareArray(Object.keys(value), ["point", "label"]);
  assert.sameValue(typeof value.point, "object"); assert.sameValue(typeof value.label, "string"); assert.sameValue(value.label, label);
  const point: unknown[] = value.point;
  assert.sameValue(point.length, 2); assert.compareArray(Object.keys(point), ["0", "1"]);
  assert.sameValue(typeof point[0], "number"); assert.sameValue(Object.is(point[0], x), true);
  assert.sameValue(typeof point[1], "number"); assert.sameValue(Object.is(point[1], y), true);
}
const inputs: [string, number, number, string][] = [
  ['{"point":[-0,0],"label":"zero"}', -0, 0, "zero"],
  ['{"point":[2.5,-1.25],"label":"fraction"}', 2.5, -1.25, "fraction"],
  ['{"point":[1e3,-2e-3],"label":"exponent"}', 1000, -0.002, "exponent"],
];
for (const [text, x, y, label] of inputs) check(text, x, y, label);
