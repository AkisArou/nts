/*---
description: Control for shapes-interface-optional-presence; parse to unknown and narrow before reading.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-objects, ts-optional-properties, ts-numbers, ts-strings, ts-tuples]
---*/
// Only parse, holder or return annotations change to unknown; text, runtime guards and assertions are identical.
interface JsonOptional { label: string; amount?: number; }
function check(text: string, present: boolean, expected: number): void {
  const value: unknown = JSON.parse(text);
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
