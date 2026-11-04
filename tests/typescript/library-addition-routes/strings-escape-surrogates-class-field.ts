/*---
description: "RegExp.escape distinguishes lone UTF-16 halves from valid pairs through a repeatedly written class field."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-class, ts-class-fields, ts-this, ts-tuples, ts-narrowing, ts-null-undefined, ts-unicode-sequences]
---*/
// RegExp.escape through a public string field; node Unicode-escapes lone surrogates and retains valid pairs even beside unmatched halves.
const log: string[] = [];
class Source {
  text: string = "";
  run(expected: string): string {
    log.push("run"); const text = this.text;
    return RegExp.escape(text);
  }
}
const rows: [string, string][] = [
  ["\ud800", "\\ud800"], ["\ud800A", "\\ud800A"], ["A\ud800", "\\x41\\ud800"], ["A\ud800B", "\\x41\\ud800B"], ["\udbff", "\\udbff"],
  ["\udbffA", "\\udbffA"], ["A\udbff", "\\x41\\udbff"], ["A\udbffB", "\\x41\\udbffB"], ["\udc00", "\\udc00"], ["\udc00A", "\\udc00A"],
  ["A\udc00", "\\x41\\udc00"], ["A\udc00B", "\\x41\\udc00B"], ["\udfff", "\\udfff"], ["\udfffA", "\\udfffA"], ["A\udfff", "\\x41\\udfff"],
  ["A\udfffB", "\\x41\\udfffB"], ["\ud83d", "\\ud83d"], ["\ud83dA", "\\ud83dA"], ["A\ud83d", "\\x41\\ud83d"], ["A\ud83dB", "\\x41\\ud83dB"],
  ["\ude00", "\\ude00"], ["\ude00A", "\\ude00A"], ["A\ude00", "\\x41\\ude00"], ["A\ude00B", "\\x41\\ude00B"], ["\ud800\udc00", "\ud800\udc00"],
  ["\ud800\udfff", "\ud800\udfff"], ["\udbff\udc00", "\udbff\udc00"], ["\udbff\udfff", "\udbff\udfff"], ["\ud83d\ude00", "\ud83d\ude00"], ["\ud800\ud800\udc00", "\\ud800\ud800\udc00"],
  ["\ud800\udc00\udfff", "\ud800\udc00\\udfff"], ["\udfff\ud800", "\\udfff\\ud800"], ["\udc00\ud800\udc00", "\\udc00\ud800\udc00"], ["\ud800x\udc00", "\\ud800x\\udc00"],
];
const source = new Source();
for (const row of rows) {
  source.text = row[0]; log.length = 0; const result = source.run(row[1]), after = source.text;
  assert.compareArray(log, ["run"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "string"); assert.sameValue(after, row[0]);
  for (const flags of ["", "u", "v"]) {
    const expression = new RegExp("^(?:" + result + ")$(?![\\s\\S])", flags), found = expression.exec(row[0]);
    assert.sameValue(found === null, false);
    if (found !== null) { assert.sameValue(found[0], row[0]); assert.sameValue(found.index, 0); assert.sameValue(found.input, row[0]); assert.sameValue(found.length, 1); }
    assert.sameValue(expression.test("X" + row[0]), false); assert.sameValue(expression.test(row[0] + "X"), false); assert.sameValue(expression.test(row[0] + "\n"), false);
  }
}
