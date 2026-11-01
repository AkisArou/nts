/*---
description: A class field holding a parsed object preserves a nested numeric array without claiming the JSON object is a class instance.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-class, ts-class-fields, ts-interfaces, ts-objects, ts-arrays, ts-numbers, ts-strings, ts-tuples]
---*/
// Parse matching text into a class field type; node stores a plain object whose array values and key order remain exact.
interface JsonStoredData { name: string; values: number[]; }
class JsonDataSlot {
  data: JsonStoredData;
  constructor(text: string) { const parsed: JsonStoredData = JSON.parse(text); this.data = parsed; }
}
function check(text: string, first: number, last: number): void {
  const slot = new JsonDataSlot(text); const value = slot.data;
  assert.sameValue(typeof value, "object");
  if (typeof value !== "object" || value === null || !("name" in value) || !("values" in value) || !Array.isArray(value.values)) throw new Error("stored");
  assert.compareArray(Object.keys(value), ["values", "name"]);
  assert.sameValue(typeof value.name, "string"); assert.sameValue(value.name, "stored");
  assert.sameValue(typeof value.values, "object");
  const values: unknown[] = value.values; const expected: number[] = [first, 0, last];
  assert.sameValue(values.length, 3); assert.compareArray(Object.keys(values), ["0", "1", "2"]);
  for (let i = 0; i < values.length; i++) {
    assert.sameValue(typeof values[i], "number"); assert.sameValue(Object.is(values[i], expected[i]), true);
  }
}
const inputs: [string, number, number][] = [
  ['{"values":[-0,0,1.5],"name":"stored"}', -0, 1.5],
  ['{"values":[1e3,0,-2.5],"name":"stored"}', 1000, -2.5],
  ['{"values":[9007199254740993,0,-0],"name":"stored"}', 9007199254740992, -0],
];
for (const [text, first, last] of inputs) check(text, first, last);
