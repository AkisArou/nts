/*---
description: "RegExp.escape quotes every RegExp syntax character and solidus through a tuple element."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-type-aliases, ts-tuples, ts-narrowing, ts-null-undefined, ts-unicode-sequences]
---*/
// RegExp.escape through a typed tuple; node backslash-escapes each syntax character and slash at the start, middle and end.
const log: string[] = [];
type Source = [string, number];
function run(source: Source, expected: string): string {
  log.push("run"); const text = source[0];
  return RegExp.escape(text);
}
const rows: [string, string][] = [
  ["^", "\\^"], ["^A", "\\^A"], ["A^", "\\x41\\^"], ["A^B", "\\x41\\^B"], ["$", "\\$"],
  ["$A", "\\$A"], ["A$", "\\x41\\$"], ["A$B", "\\x41\\$B"], ["\\", "\\\\"], ["\\A", "\\\\A"],
  ["A\\", "\\x41\\\\"], ["A\\B", "\\x41\\\\B"], [".", "\\."], [".A", "\\.A"], ["A.", "\\x41\\."],
  ["A.B", "\\x41\\.B"], ["*", "\\*"], ["*A", "\\*A"], ["A*", "\\x41\\*"], ["A*B", "\\x41\\*B"],
  ["+", "\\+"], ["+A", "\\+A"], ["A+", "\\x41\\+"], ["A+B", "\\x41\\+B"], ["?", "\\?"],
  ["?A", "\\?A"], ["A?", "\\x41\\?"], ["A?B", "\\x41\\?B"], ["(", "\\("], ["(A", "\\(A"],
  ["A(", "\\x41\\("], ["A(B", "\\x41\\(B"], [")", "\\)"], [")A", "\\)A"], ["A)", "\\x41\\)"],
  ["A)B", "\\x41\\)B"], ["[", "\\["], ["[A", "\\[A"], ["A[", "\\x41\\["], ["A[B", "\\x41\\[B"],
  ["]", "\\]"], ["]A", "\\]A"], ["A]", "\\x41\\]"], ["A]B", "\\x41\\]B"], ["{", "\\{"],
  ["{A", "\\{A"], ["A{", "\\x41\\{"], ["A{B", "\\x41\\{B"], ["}", "\\}"], ["}A", "\\}A"],
  ["A}", "\\x41\\}"], ["A}B", "\\x41\\}B"], ["|", "\\|"], ["|A", "\\|A"], ["A|", "\\x41\\|"],
  ["A|B", "\\x41\\|B"], ["/", "\\/"], ["/A", "\\/A"], ["A/", "\\x41\\/"], ["A/B", "\\x41\\/B"],
];
for (const row of rows) {
  const source: Source = [row[0], 17]; log.length = 0; const result = run(source, row[1]), after = source[0];
  assert.compareArray(log, ["run"]); assert.sameValue(source[1], 17);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "string"); assert.sameValue(after, row[0]);
  for (const flags of ["", "u", "v"]) {
    const expression = new RegExp("^(?:" + result + ")$(?![\\s\\S])", flags), found = expression.exec(row[0]);
    assert.sameValue(found === null, false);
    if (found !== null) { assert.sameValue(found[0], row[0]); assert.sameValue(found.index, 0); assert.sameValue(found.input, row[0]); assert.sameValue(found.length, 1); }
    assert.sameValue(expression.test("X" + row[0]), false); assert.sameValue(expression.test(row[0] + "X"), false); assert.sameValue(expression.test(row[0] + "\n"), false);
  }
}
