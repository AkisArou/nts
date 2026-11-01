/*---
description: Control for stringify-interface-surrogates; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-strings, ts-tuples]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
interface JsonStringRecord { text: string; end: boolean; }
const rows: [string, string][] = [
  ["\ud800", "\\ud800"], ["\udfff", "\\udfff"], ["\ud800x\udc00", "\\ud800x\\udc00"],
  ["\ud83d\ude00", "\ud83d\ude00"], ["\udc00\ud800", "\\udc00\\ud800"],
];
for (const [text, encoded] of rows) {
  const value = { text, end: true };
  assert.sameValue(JSON.stringify(value), `{"text":"${encoded}","end":true}`);
  assert.sameValue(value.text, text);
}
