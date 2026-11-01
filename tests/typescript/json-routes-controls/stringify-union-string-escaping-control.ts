/*---
description: Control for stringify-union-string-escaping; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-unions, ts-objects, ts-strings, ts-tuples]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
interface JsonEscapedRecord { text: string | number; }
const rows: [string, string][] = [
  ["\b\f\n\r\t", "\\b\\f\\n\\r\\t"], ["\"\\/", "\\\"\\\\/"],
  ["\u0000\u0001", "\\u0000\\u0001"], ["a\u2028b\u2029c", "a\u2028b\u2029c"],
];
for (const [text, encoded] of rows) {
  const value = { text };
  assert.sameValue(JSON.stringify(value), `{"text":"${encoded}"}`);
}
