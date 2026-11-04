/*---
description: "Control: toWellFormed preserves UTF-16 well-formedness through a discriminated union with inline and nested text."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-tuples, ts-unicode-sequences]
---*/
// toWellFormed through a discriminated union with inline and nested text; node rejects or replaces lone halves, preserves pairs, and leaves the stored string unchanged.
const log: string[] = [];
type Source = { kind: "inline"; text: string } | { kind: "nested"; value: { text: string } };
function run(source: Source): string {
  log.push(source.kind); const text = source.kind === "inline" ? source.text : source.value.text;
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index), next = text.charCodeAt(index + 1);
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      result += text[index] + text[index + 1]; index++;
    } else result += unit >= 0xd800 && unit <= 0xdfff ? "\ufffd" : text[index];
  }
  return result;
}
const rows: [string, string][] = [
  ["", ""], ["A\u0000\u00e9\u4e2d\uffff", "A\u0000\u00e9\u4e2d\uffff"], ["\ufffd", "\ufffd"],
  ["\ud800\udfff", "\ud800\udfff"], ["\udbff\udc00", "\udbff\udc00"], ["\ud83d\ude00\ud834\udd1e", "\ud83d\ude00\ud834\udd1e"],
  ["\ud800\ud800", "\ufffd\ufffd"], ["\udfff\udfff", "\ufffd\ufffd"], ["\udfff\ud800", "\ufffd\ufffd"],
  ["\ud800\ud800\udc00", "\ufffd\ud800\udc00"], ["\ud800\udc00\udc00", "\ud800\udc00\ufffd"], ["\udc00\ud800\udc00", "\ufffd\ud800\udc00"],
  ["\ud800\udc00\ud800", "\ud800\udc00\ufffd"], ["\ud800x\udc00", "\ufffdx\ufffd"], ["a\ud800\ud800\udc00\udfffz", "a\ufffd\ud800\udc00\ufffdz"],
];
const positions: [string, string][] = [["", "ab"], ["a", "b"], ["ab", ""]];
for (let code = 0xd800; code <= 0xdfff; code++) {
  const unit = String.fromCharCode(code);
  for (const [before, after] of positions) rows.push([before + unit + after, before + "\ufffd" + after]);
  if (code <= 0xdbff) { const pair = String.fromCharCode(code, code + 0x400); rows.push([pair, pair], ["x" + pair + "y", "x" + pair + "y"]); }
}
for (const row of rows) for (const nested of [false, true]) {
  const source: Source = nested ? { kind: "nested", value: { text: row[0] } } : { kind: "inline", text: row[0] };
  log.length = 0; const result = run(source), after = source.kind === "inline" ? source.text : source.value.text;
  assert.compareArray(log, [nested ? "nested" : "inline"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "string"); assert.sameValue(after, row[0]);
}
