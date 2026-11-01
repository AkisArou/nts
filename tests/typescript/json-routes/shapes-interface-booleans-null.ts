/*---
description: A matching interface preserves both boolean values and a null field without conflating their runtime kinds.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-objects, ts-null-undefined, ts-tuples]
---*/
// Parse matching boolean/null fields into an interface; node preserves false, true, null and property order.
interface JsonSwitches { left: boolean; right: boolean; empty: null; }
function check(text: string, left: boolean, right: boolean): void {
  const value: JsonSwitches = JSON.parse(text);
  assert.sameValue(typeof value, "object");
  if (typeof value !== "object" || value === null || !("left" in value) || !("right" in value) || !("empty" in value)) throw new Error("switches");
  assert.compareArray(Object.keys(value), ["empty", "left", "right"]);
  assert.sameValue(typeof value.left, "boolean"); assert.sameValue(value.left, left);
  assert.sameValue(typeof value.right, "boolean"); assert.sameValue(value.right, right);
  assert.sameValue(typeof value.empty, "object"); assert.sameValue(value.empty, null);
}
const inputs: [string, boolean, boolean][] = [
  ['{"empty":null,"left":false,"right":true}', false, true],
  ['{"empty":null,"left":true,"right":false}', true, false],
  ['{"empty":null,"left":false,"right":false}', false, false],
];
for (const [text, left, right] of inputs) check(text, left, right);
