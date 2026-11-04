/*---
description: "RegExp.escape preserves ordinary non-ASCII text and non-whitespace look-alikes through a narrowed union."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-type-aliases, ts-unions, ts-objects, ts-tuples, ts-narrowing, ts-null-undefined, ts-unicode-sequences]
---*/
// RegExp.escape through a discriminated text union; node keeps non-ASCII letters, valid supplementary characters and non-whitespace controls unchanged.
const log: string[] = [];
type Source = { kind: "inline"; text: string } | { kind: "nested"; value: string };
function run(source: Source, expected: string): string {
  log.push(source.kind); const text = source.kind === "inline" ? source.text : source.value;
  return RegExp.escape(text);
}
const rows: [string, string][] = [
  ["\u00e9", "\u00e9"], ["\u0100", "\u0100"], ["\u4e2d", "\u4e2d"], ["\u03a9", "\u03a9"], ["\u0430", "\u0430"],
  ["\u05d0", "\u05d0"], ["\u0643", "\u0643"], ["\u00f1", "\u00f1"], ["\u00df", "\u00df"], ["e\u0301", "\\x65\u0301"],
  ["\u0301", "\u0301"], ["\ud83d\ude04", "\ud83d\ude04"], ["\ud801\udc00", "\ud801\udc00"], ["_", "_"], ["\u00e91", "\u00e91"],
  ["A\u00e9", "\\x41\u00e9"], ["\u0085", "\u0085"], ["\u180e", "\u180e"], ["\u200b", "\u200b"], ["\u0000", "\u0000"],
  ["\b", "\b"], ["\u007f", "\u007f"], ["\u00ad", "\u00ad"], ["\u2014", "\u2014"],
];
for (const row of rows) for (const nested of [false, true]) {
  const source: Source = nested ? { kind: "nested", value: row[0] } : { kind: "inline", text: row[0] };
  log.length = 0; const result = run(source, row[1]), after = source.kind === "inline" ? source.text : source.value;
  assert.compareArray(log, [nested ? "nested" : "inline"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "string"); assert.sameValue(after, row[0]);
  for (const flags of ["", "u", "v"]) {
    const expression = new RegExp("^(?:" + result + ")$(?![\\s\\S])", flags), found = expression.exec(row[0]);
    assert.sameValue(found === null, false);
    if (found !== null) { assert.sameValue(found[0], row[0]); assert.sameValue(found.index, 0); assert.sameValue(found.input, row[0]); assert.sameValue(found.length, 1); }
    assert.sameValue(expression.test("X" + row[0]), false); assert.sameValue(expression.test(row[0] + "X"), false); assert.sameValue(expression.test(row[0] + "\n"), false);
  }
}
