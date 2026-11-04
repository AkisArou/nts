/*---
description: "toWellFormed preserves UTF-16 well-formedness through one interface with field, accessor and object-literal implementations."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-interfaces, ts-class, ts-class-fields, ts-accessors, ts-this, ts-objects, ts-tuples, ts-unicode-sequences]
---*/
// toWellFormed through one interface with field, accessor and object-literal implementations; node rejects or replaces lone halves, preserves pairs, and leaves the stored string unchanged.
const log: string[] = [];
interface Source { readonly text: string; }
class Field implements Source { text: string; constructor(text: string) { log.push("field:new"); this.text = text; } }
class Accessor implements Source { raw: string; constructor(text: string) { log.push("accessor:new"); this.raw = text; } get text(): string { log.push("get"); return this.raw; } }
function run(source: Source): string {
  log.push("run"); const text = source.text;
  return text.toWellFormed();
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
for (const row of rows) for (const origin of [0, 1, 2]) {
  const source: Source = origin === 0 ? new Field(row[0]) : origin === 1 ? new Accessor(row[0]) : { text: row[0] };
  log.length = 0; const result = run(source), after = source.text;
  assert.compareArray(log, origin === 1 ? ["run", "get", "get"] : ["run"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "string"); assert.sameValue(after, row[0]);
}
