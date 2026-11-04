/*---
description: "RegExp.escape hex-escapes an initial ASCII letter or digit through a constrained generic."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-generics, ts-generic-constraints, ts-tuples, ts-narrowing, ts-null-undefined, ts-unicode-sequences]
---*/
// RegExp.escape through a generic string parameter; node emits a leading lowercase hex escape and preserves later letters and digits.
const log: string[] = [];
function run<T extends string>(text: T, expected: string): string {
  log.push("run");
  return RegExp.escape(text);
}
const rows: [string, string][] = [
  ["0", "\\x30"], ["1", "\\x31"], ["2", "\\x32"], ["3", "\\x33"], ["4", "\\x34"],
  ["5", "\\x35"], ["6", "\\x36"], ["7", "\\x37"], ["8", "\\x38"], ["9", "\\x39"],
  ["A", "\\x41"], ["B", "\\x42"], ["C", "\\x43"], ["D", "\\x44"], ["E", "\\x45"],
  ["F", "\\x46"], ["G", "\\x47"], ["H", "\\x48"], ["I", "\\x49"], ["J", "\\x4a"],
  ["K", "\\x4b"], ["L", "\\x4c"], ["M", "\\x4d"], ["N", "\\x4e"], ["O", "\\x4f"],
  ["P", "\\x50"], ["Q", "\\x51"], ["R", "\\x52"], ["S", "\\x53"], ["T", "\\x54"],
  ["U", "\\x55"], ["V", "\\x56"], ["W", "\\x57"], ["X", "\\x58"], ["Y", "\\x59"],
  ["Z", "\\x5a"], ["a", "\\x61"], ["b", "\\x62"], ["c", "\\x63"], ["d", "\\x64"],
  ["e", "\\x65"], ["f", "\\x66"], ["g", "\\x67"], ["h", "\\x68"], ["i", "\\x69"],
  ["j", "\\x6a"], ["k", "\\x6b"], ["l", "\\x6c"], ["m", "\\x6d"], ["n", "\\x6e"],
  ["o", "\\x6f"], ["p", "\\x70"], ["q", "\\x71"], ["r", "\\x72"], ["s", "\\x73"],
  ["t", "\\x74"], ["u", "\\x75"], ["v", "\\x76"], ["w", "\\x77"], ["x", "\\x78"],
  ["y", "\\x79"], ["z", "\\x7a"], ["aA09", "\\x61A09"], ["Zz19", "\\x5az19"], ["0abc", "\\x30abc"],
  ["9Z9", "\\x39Z9"], ["\u00e9a1", "\u00e9a1"], ["_a1", "_a1"], ["", ""],
];
for (const row of rows) {
  const text: string = row[0]; log.length = 0; const result = run(text, row[1]), after = text;
  assert.compareArray(log, ["run"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "string"); assert.sameValue(after, row[0]);
  for (const flags of ["", "u", "v"]) {
    const expression = new RegExp("^(?:" + result + ")$(?![\\s\\S])", flags), found = expression.exec(row[0]);
    assert.sameValue(found === null, false);
    if (found !== null) { assert.sameValue(found[0], row[0]); assert.sameValue(found.index, 0); assert.sameValue(found.input, row[0]); assert.sameValue(found.length, 1); }
    assert.sameValue(expression.test("X" + row[0]), false); assert.sameValue(expression.test(row[0] + "X"), false); assert.sameValue(expression.test(row[0] + "\n"), false);
  }
}
