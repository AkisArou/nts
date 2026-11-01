/*---
description: Control for shapes-class-field-surrogate-string; parse to unknown and narrow before reading.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-class, ts-class-fields, ts-strings, ts-tuples]
---*/
// Only parse, holder or return annotations change to unknown; text, runtime guards and assertions are identical.
class JsonTextSlot {
  text: unknown;
  constructor(source: string) { const parsed: unknown = JSON.parse(source); this.text = parsed; }
}
function check(source: string, expected: string): void {
  const slot = new JsonTextSlot(source); const value = slot.text;
  if (typeof value !== "string") throw new Error("string");
  assert.sameValue(typeof value, "string"); assert.sameValue(value, expected);
  assert.sameValue(value.length, expected.length);
  const keys: string[] = [];
  for (let i = 0; i < expected.length; i++) { keys.push(String(i)); assert.sameValue(value.charCodeAt(i), expected.charCodeAt(i)); }
  assert.compareArray(Object.keys(value), keys);
}
const inputs: [string, string][] = [
  ["\"\\ud83d\\ude03\"", "\ud83d\ude03"],
  ["\"\\ud800\"", "\ud800"],
  ["\"\\udfff\"", "\udfff"],
  ["\"\\ud800A\\udfff\"", "\ud800A\udfff"]
];
for (const [source, expected] of inputs) check(source, expected);
