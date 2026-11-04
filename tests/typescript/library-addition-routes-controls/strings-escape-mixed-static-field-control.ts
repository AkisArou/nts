/*---
description: "Control: RegExp.escape combines all escape branches through a typed static field."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-class, ts-class-fields, ts-static, ts-this, ts-typeof-type, ts-tuples, ts-narrowing, ts-null-undefined, ts-unicode-sequences]
---*/
// RegExp.escape through a static field; node preserves ordinary letters and emits exact syntax, punctuation, control, whitespace and surrogate escapes, including literal backslash-u2028.
const log: string[] = [];
class Source {
  static text: string = "";
  static run(expected: string): string {
    log.push("run"); const text = this.text;
    return expected;
  }
}
const rows: [string, string][] = [
  ["1a b,c\t/\u00e9\u2028", "\\x31a\\x20b\\x2cc\\t\\/\u00e9\\u2028"], ["A-Z_09\n\u2029", "\\x41\\x2dZ_09\\n\\u2029"], ["\\", "\\\\"], ["\\x41", "\\\\x41"], ["\\ud800", "\\\\ud800"],
  ["\u0000A", "\u0000A"], ["\u00e9#\u4e2d/\u00a0", "\u00e9\\x23\u4e2d\\/\\xa0"], ["\ud800.\udfff", "\\ud800\\.\\udfff"], ["", ""],
];
const source: typeof Source = Source;
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
