/*---
description: "Control: RegExp.escape reads stored literal pattern text through a Map without changing it."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-map-set, ts-errors, ts-tuples, ts-narrowing, ts-null-undefined, ts-unicode-sequences]
---*/
// RegExp.escape through a checked Map lookup; node quotes stored alternatives, groups, quantifiers, backslashes and empty text as literal characters.
const log: string[] = [];
function run(source: Map<string, string>, expected: string): string {
  log.push("run"); const text = source.get("text");
  if (text === undefined) throw new Error("missing input");
  return expected;
}
const rows: [string, string][] = [
  ["", ""], ["a|b", "\\x61\\|b"], ["[x](y){2}", "\\[x\\]\\(y\\)\\{2\\}"], ["/a.*\\b/", "\\/a\\.\\*\\\\b\\/"], ["$x^?", "\\$x\\^\\?"],
  ["https://a.b/x?y=1#z", "\\x68ttps\\x3a\\/\\/a\\.b\\/x\\?y\\x3d1\\x23z"], ["line\nnext", "\\x6cine\\nnext"], ["a+b*c?", "\\x61\\+b\\*c\\?"], ["(a)(b)\\1", "\\(a\\)\\(b\\)\\\\1"], ["\u00e9\u2028\u4e2d", "\u00e9\\u2028\u4e2d"],
];
const source: Map<string, string> = new Map();
for (const row of rows) {
  source.set("text", row[0]); log.length = 0; const result = run(source, row[1]), after = source.get("text");
  assert.compareArray(log, ["run"]); assert.sameValue(source.size, 1);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "string"); assert.sameValue(after, row[0]);
  for (const flags of ["", "u", "v"]) {
    const expression = new RegExp("^(?:" + result + ")$(?![\\s\\S])", flags), found = expression.exec(row[0]);
    assert.sameValue(found === null, false);
    if (found !== null) { assert.sameValue(found[0], row[0]); assert.sameValue(found.index, 0); assert.sameValue(found.input, row[0]); assert.sameValue(found.length, 1); }
    assert.sameValue(expression.test("X" + row[0]), false); assert.sameValue(expression.test(row[0] + "X"), false); assert.sameValue(expression.test(row[0] + "\n"), false);
  }
}
