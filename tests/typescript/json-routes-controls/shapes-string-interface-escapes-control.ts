/*---
description: Control for shapes-string-interface-escapes; parse to unknown and narrow before reading.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-objects, ts-strings, ts-tuples]
---*/
// Only parse, holder or return annotations change to unknown; text, runtime guards and assertions are identical.
interface JsonEscapedText { text: string; }
function check(text: string, expected: string): void {
  const value: unknown = JSON.parse(text);
  assert.sameValue(typeof value, "object");
  if (typeof value !== "object" || value === null || !("text" in value) || typeof value.text !== "string") throw new Error("text");
  assert.compareArray(Object.keys(value), ["text"]);
  assert.sameValue(typeof value.text, "string"); assert.sameValue(value.text, expected);
  assert.sameValue(value.text.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.sameValue(value.text.charCodeAt(i), expected.charCodeAt(i));
}
const inputs: [string, string][] = [
  ["{\"text\":\"quote:\\\"\"}", "quote:\""],
  ["{\"text\":\"slash:\\/\"}", "slash:/"],
  ["{\"text\":\"backslash:\\\\\"}", "backslash:\\"],
  ["{\"text\":\"\\b\\f\\n\\r\\t\"}", "\b\f\n\r\t"],
  ["{\"text\":\"\\u0041\\u0000\\u00e9\"}", "A\u0000\u00e9"]
];
for (const [text, expected] of inputs) check(text, expected);
