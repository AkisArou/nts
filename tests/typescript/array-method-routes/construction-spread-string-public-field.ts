/*---
description: "String spread copies whole code points into fresh arrays while retaining their order."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-this, ts-strings, ts-readonly, ts-tuples, ts-destructuring, ts-spread]
---*/

// String spread copies whole code points into fresh arrays while retaining their order. Route: a declared public string field. Node prints construction-spread-string-public-field:ok.
class SpreadText {
  value: string; constructor(value: string) { this.value = value; }
  copy(): string[] { return [...this.value]; }
}
const rows: readonly [string, readonly string[], number][] = [
  ["", [], 0], ["ab", ["a", "b"], 2], ["a\u{1f600}b", ["a", "\u{1f600}", "b"], 4],
  ["\u{1f600}\u{1d11e}", ["\u{1f600}", "\u{1d11e}"], 4], ["e\u0301", ["e", "\u0301"], 2]
];
for (const [text, expected, units] of rows) {
  const holder = new SpreadText(text), result = holder.copy(), repeated = holder.copy();
  assert.compareArray(result, expected); assert.sameValue(result === repeated, false);
  assert.sameValue(text.length, units); holder.value = "changed";
  assert.compareArray(result, expected);
}
console.log("construction-spread-string-public-field:ok");
