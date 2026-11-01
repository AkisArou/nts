/*---
description: An interface string field escapes lone surrogates while retaining paired surrogates and surrounding text.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-strings, ts-tuples]
---*/
// Serialize an interface string field; node escapes each unpaired code unit and emits a valid pair unchanged.
interface JsonStringRecord { text: string; end: boolean; }
const rows: [string, string][] = [
  ["\ud800", "\\ud800"], ["\udfff", "\\udfff"], ["\ud800x\udc00", "\\ud800x\\udc00"],
  ["\ud83d\ude00", "\ud83d\ude00"], ["\udc00\ud800", "\\udc00\\ud800"],
];
for (const [text, encoded] of rows) {
  const value: JsonStringRecord = { text, end: true };
  assert.sameValue(JSON.stringify(value), `{"text":"${encoded}","end":true}`);
  assert.sameValue(value.text, text);
}
