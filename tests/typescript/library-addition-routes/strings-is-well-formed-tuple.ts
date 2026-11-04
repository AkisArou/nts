/*---
description: "isWellFormed preserves UTF-16 well-formedness through a declared tuple string element."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-type-aliases, ts-tuples, ts-unicode-sequences]
---*/
// isWellFormed through a declared tuple string element; node rejects or replaces lone halves, preserves pairs, and leaves the stored string unchanged.
const log: string[] = [];
type Source = [number, string];
function run(source: Source): boolean {
  log.push("run"); const text = source[1];
  return text.isWellFormed();
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
for (const row of rows) {
  const source: Source = [17, row[0]]; log.length = 0; const result = run(source);
  assert.compareArray(log, ["run"]);
  assert.sameValue(result, row[0] === row[1]); assert.sameValue(typeof result, "boolean"); assert.compareArray(source, [17, row[0]]);
}
