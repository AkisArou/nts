/*---
description: "Control: RegExp.escape hex-escapes every other ASCII punctuator read through an interface accessor."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-interfaces, ts-accessors, ts-objects, ts-readonly, ts-tuples, ts-narrowing, ts-null-undefined, ts-unicode-sequences]
---*/
// RegExp.escape through an interface getter; node reads once per call and emits hex escapes for punctuators that cannot safely use identity escapes.
const log: string[] = [];
interface Source { readonly text: string; }
function run(source: Source, expected: string): string {
  log.push("run"); const text = source.text;
  return expected;
}
const rows: [string, string][] = [
  [",", "\\x2c"], [",A", "\\x2cA"], ["A,", "\\x41\\x2c"], ["A,B", "\\x41\\x2cB"], ["-", "\\x2d"],
  ["-A", "\\x2dA"], ["A-", "\\x41\\x2d"], ["A-B", "\\x41\\x2dB"], ["=", "\\x3d"], ["=A", "\\x3dA"],
  ["A=", "\\x41\\x3d"], ["A=B", "\\x41\\x3dB"], ["<", "\\x3c"], ["<A", "\\x3cA"], ["A<", "\\x41\\x3c"],
  ["A<B", "\\x41\\x3cB"], [">", "\\x3e"], [">A", "\\x3eA"], ["A>", "\\x41\\x3e"], ["A>B", "\\x41\\x3eB"],
  ["#", "\\x23"], ["#A", "\\x23A"], ["A#", "\\x41\\x23"], ["A#B", "\\x41\\x23B"], ["&", "\\x26"],
  ["&A", "\\x26A"], ["A&", "\\x41\\x26"], ["A&B", "\\x41\\x26B"], ["!", "\\x21"], ["!A", "\\x21A"],
  ["A!", "\\x41\\x21"], ["A!B", "\\x41\\x21B"], ["%", "\\x25"], ["%A", "\\x25A"], ["A%", "\\x41\\x25"],
  ["A%B", "\\x41\\x25B"], [":", "\\x3a"], [":A", "\\x3aA"], ["A:", "\\x41\\x3a"], ["A:B", "\\x41\\x3aB"],
  [";", "\\x3b"], [";A", "\\x3bA"], ["A;", "\\x41\\x3b"], ["A;B", "\\x41\\x3bB"], ["@", "\\x40"],
  ["@A", "\\x40A"], ["A@", "\\x41\\x40"], ["A@B", "\\x41\\x40B"], ["~", "\\x7e"], ["~A", "\\x7eA"],
  ["A~", "\\x41\\x7e"], ["A~B", "\\x41\\x7eB"], ["'", "\\x27"], ["'A", "\\x27A"], ["A'", "\\x41\\x27"],
  ["A'B", "\\x41\\x27B"], ["\"", "\\x22"], ["\"A", "\\x22A"], ["A\"", "\\x41\\x22"], ["A\"B", "\\x41\\x22B"],
  ["`", "\\x60"], ["`A", "\\x60A"], ["A`", "\\x41\\x60"], ["A`B", "\\x41\\x60B"],
];
for (const row of rows) {
  const source: Source = { get text(): string { log.push("get"); return row[0]; } };
  log.length = 0; const result = run(source, row[1]), after = source.text;
  assert.compareArray(log, ["run", "get", "get"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "string"); assert.sameValue(after, row[0]);
  for (const flags of ["", "u", "v"]) {
    const expression = new RegExp("^(?:" + result + ")$(?![\\s\\S])", flags), found = expression.exec(row[0]);
    assert.sameValue(found === null, false);
    if (found !== null) { assert.sameValue(found[0], row[0]); assert.sameValue(found.index, 0); assert.sameValue(found.input, row[0]); assert.sameValue(found.length, 1); }
    assert.sameValue(expression.test("X" + row[0]), false); assert.sameValue(expression.test(row[0] + "X"), false); assert.sameValue(expression.test(row[0] + "\n"), false);
  }
}
