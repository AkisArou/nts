/*---
description: An optional numeric interface field remains absent when omitted and preserves negative zero when present.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-objects, ts-optional-properties, ts-numbers, ts-strings, ts-tuples]
---*/
// Parse matching optional-field shapes; node keeps an omitted field absent rather than creating an own undefined property.
interface JsonOptional { label: string; amount?: number; }
function check(text: string, present: boolean, expected: number): void {
  const value: JsonOptional = JSON.parse(text);
  assert.sameValue(typeof value, "object");
  if (typeof value !== "object" || value === null || !("label" in value)) throw new Error("optional");
  assert.sameValue(typeof value.label, "string"); assert.sameValue(value.label, "optional");
  assert.compareArray(Object.keys(value), present ? ["label", "amount"] : ["label"]);
  assert.sameValue(Object.hasOwn(value, "amount"), present); assert.sameValue("amount" in value, present);
  if ("amount" in value) {
    assert.sameValue(typeof value.amount, "number"); assert.sameValue(Object.is(value.amount, expected), true);
  }
}
const inputs: [string, boolean, number][] = [
  ['{"label":"optional"}', false, 0], ['{"label":"optional","amount":-0}', true, -0],
  ['{"label":"optional","amount":1.25e2}', true, 125],
];
for (const [text, present, expected] of inputs) check(text, present, expected);
