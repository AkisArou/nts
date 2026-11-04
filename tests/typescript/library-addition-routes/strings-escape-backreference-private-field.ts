/*---
description: "RegExp.escape keeps a private string distinct from a preceding numeric backreference."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-tuples, ts-narrowing, ts-null-undefined, ts-unicode-sequences]
---*/
// RegExp.escape through a private string field; node hex-escapes its first letter or digit so concatenation after a backreference still matches the original text.
const log: string[] = [];
class Source {
  #text: string;
  constructor(text: string) { log.push("new"); this.#text = text; }
  read(): string { log.push("read"); return this.#text; }
  run(expected: string): string {
    log.push("run"); const text = this.#text;
    return RegExp.escape(text);
  }
}
const rows: [string, string][] = [
  ["0", "\\x30"], ["1", "\\x31"], ["2", "\\x32"], ["9", "\\x39"], ["12", "\\x312"],
  ["01", "\\x301"], ["a", "\\x61"], ["f", "\\x66"], ["A", "\\x41"], ["Z", "\\x5a"],
  ["a0", "\\x610"],
];
for (const row of rows) {
  const source = new Source(row[0]); log.length = 0; const result = source.run(row[1]), after = source.read();
  assert.compareArray(log, ["run", "read"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "string"); assert.sameValue(after, row[0]);
  for (const flags of ["", "u", "v"]) {
    const expression = new RegExp("^(?:" + result + ")$(?![\\s\\S])", flags), found = expression.exec(row[0]);
    assert.sameValue(found === null, false);
    if (found !== null) { assert.sameValue(found[0], row[0]); assert.sameValue(found.index, 0); assert.sameValue(found.input, row[0]); assert.sameValue(found.length, 1); }
    assert.sameValue(expression.test("X" + row[0]), false); assert.sameValue(expression.test(row[0] + "X"), false); assert.sameValue(expression.test(row[0] + "\n"), false);
  }
  const combined = new RegExp("^(a)\\1" + result + "$(?![\\s\\S])", "u"), match = combined.exec("aa" + row[0]);
  assert.sameValue(match === null, false);
  if (match !== null) { assert.sameValue(match[0], "aa" + row[0]); assert.sameValue(match[1], "a"); assert.sameValue(match.length, 2); }
  assert.sameValue(combined.test("aa" + row[0] + "X"), false);
}
