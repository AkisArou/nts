/*---
description: "Control: RegExp.escape quotes every ECMAScript whitespace and line terminator through a readonly array."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-readonly, ts-tuples, ts-narrowing, ts-null-undefined, ts-unicode-sequences]
---*/
// RegExp.escape through a readonly string element; node emits control, hex or Unicode escapes without changing the stored input.
const log: string[] = [];
function run(source: readonly string[], expected: string): string {
  log.push("run"); const text = source[1];
  return expected;
}
const rows: [string, string][] = [
  ["\t", "\\t"], ["\tA", "\\tA"], ["A\t", "\\x41\\t"], ["A\tB", "\\x41\\tB"], ["\n", "\\n"],
  ["\nA", "\\nA"], ["A\n", "\\x41\\n"], ["A\nB", "\\x41\\nB"], ["\u000b", "\\v"], ["\u000bA", "\\vA"],
  ["A\u000b", "\\x41\\v"], ["A\u000bB", "\\x41\\vB"], ["\f", "\\f"], ["\fA", "\\fA"], ["A\f", "\\x41\\f"],
  ["A\fB", "\\x41\\fB"], ["\r", "\\r"], ["\rA", "\\rA"], ["A\r", "\\x41\\r"], ["A\rB", "\\x41\\rB"],
  [" ", "\\x20"], [" A", "\\x20A"], ["A ", "\\x41\\x20"], ["A B", "\\x41\\x20B"], ["\u00a0", "\\xa0"],
  ["\u00a0A", "\\xa0A"], ["A\u00a0", "\\x41\\xa0"], ["A\u00a0B", "\\x41\\xa0B"], ["\u1680", "\\u1680"], ["\u1680A", "\\u1680A"],
  ["A\u1680", "\\x41\\u1680"], ["A\u1680B", "\\x41\\u1680B"], ["\u2000", "\\u2000"], ["\u2000A", "\\u2000A"], ["A\u2000", "\\x41\\u2000"],
  ["A\u2000B", "\\x41\\u2000B"], ["\u2001", "\\u2001"], ["\u2001A", "\\u2001A"], ["A\u2001", "\\x41\\u2001"], ["A\u2001B", "\\x41\\u2001B"],
  ["\u2002", "\\u2002"], ["\u2002A", "\\u2002A"], ["A\u2002", "\\x41\\u2002"], ["A\u2002B", "\\x41\\u2002B"], ["\u2003", "\\u2003"],
  ["\u2003A", "\\u2003A"], ["A\u2003", "\\x41\\u2003"], ["A\u2003B", "\\x41\\u2003B"], ["\u2004", "\\u2004"], ["\u2004A", "\\u2004A"],
  ["A\u2004", "\\x41\\u2004"], ["A\u2004B", "\\x41\\u2004B"], ["\u2005", "\\u2005"], ["\u2005A", "\\u2005A"], ["A\u2005", "\\x41\\u2005"],
  ["A\u2005B", "\\x41\\u2005B"], ["\u2006", "\\u2006"], ["\u2006A", "\\u2006A"], ["A\u2006", "\\x41\\u2006"], ["A\u2006B", "\\x41\\u2006B"],
  ["\u2007", "\\u2007"], ["\u2007A", "\\u2007A"], ["A\u2007", "\\x41\\u2007"], ["A\u2007B", "\\x41\\u2007B"], ["\u2008", "\\u2008"],
  ["\u2008A", "\\u2008A"], ["A\u2008", "\\x41\\u2008"], ["A\u2008B", "\\x41\\u2008B"], ["\u2009", "\\u2009"], ["\u2009A", "\\u2009A"],
  ["A\u2009", "\\x41\\u2009"], ["A\u2009B", "\\x41\\u2009B"], ["\u200a", "\\u200a"], ["\u200aA", "\\u200aA"], ["A\u200a", "\\x41\\u200a"],
  ["A\u200aB", "\\x41\\u200aB"], ["\u2028", "\\u2028"], ["\u2028A", "\\u2028A"], ["A\u2028", "\\x41\\u2028"], ["A\u2028B", "\\x41\\u2028B"],
  ["\u2029", "\\u2029"], ["\u2029A", "\\u2029A"], ["A\u2029", "\\x41\\u2029"], ["A\u2029B", "\\x41\\u2029B"], ["\u202f", "\\u202f"],
  ["\u202fA", "\\u202fA"], ["A\u202f", "\\x41\\u202f"], ["A\u202fB", "\\x41\\u202fB"], ["\u205f", "\\u205f"], ["\u205fA", "\\u205fA"],
  ["A\u205f", "\\x41\\u205f"], ["A\u205fB", "\\x41\\u205fB"], ["\u3000", "\\u3000"], ["\u3000A", "\\u3000A"], ["A\u3000", "\\x41\\u3000"],
  ["A\u3000B", "\\x41\\u3000B"], ["\ufeff", "\\ufeff"], ["\ufeffA", "\\ufeffA"], ["A\ufeff", "\\x41\\ufeff"], ["A\ufeffB", "\\x41\\ufeffB"],
];
for (const row of rows) {
  const source: readonly string[] = ["left", row[0], "right"]; log.length = 0; const result = run(source, row[1]), after = source[1];
  assert.compareArray(log, ["run"]); assert.compareArray(source, ["left", row[0], "right"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "string"); assert.sameValue(after, row[0]);
  for (const flags of ["", "u", "v"]) {
    const expression = new RegExp("^(?:" + result + ")$(?![\\s\\S])", flags), found = expression.exec(row[0]);
    assert.sameValue(found === null, false);
    if (found !== null) { assert.sameValue(found[0], row[0]); assert.sameValue(found.index, 0); assert.sameValue(found.input, row[0]); assert.sameValue(found.length, 1); }
    assert.sameValue(expression.test("X" + row[0]), false); assert.sameValue(expression.test(row[0] + "X"), false); assert.sameValue(expression.test(row[0] + "\n"), false);
  }
}
