/*---
description: A string-or-number field serializes JSON control escapes exactly without escaping slash or Unicode line separators.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-unions, ts-objects, ts-strings, ts-tuples]
---*/
// Serialize strings through a union-typed field; node quotes controls, quote and backslash while preserving other characters.
interface JsonEscapedRecord { text: string | number; }
const rows: [string, string][] = [
  ["\b\f\n\r\t", "\\b\\f\\n\\r\\t"], ["\"\\/", "\\\"\\\\/"],
  ["\u0000\u0001", "\\u0000\\u0001"], ["a\u2028b\u2029c", "a\u2028b\u2029c"],
];
for (const [text, encoded] of rows) {
  const value: JsonEscapedRecord = { text };
  assert.sameValue(JSON.stringify(value), `{"text":"${encoded}"}`);
}
