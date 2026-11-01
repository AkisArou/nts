/*---
description: A string interface field decodes every JSON escape while preserving exact UTF-16 contents.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-objects, ts-strings, ts-tuples]
---*/
// Parse escape-bearing text into a string field; node decodes quote, slash, backslash, controls and Unicode escapes exactly.
interface JsonEscapedText { text: string; }
function check(text: string, expected: string): void {
  const value: JsonEscapedText = JSON.parse(text);
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
