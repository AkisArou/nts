/*---
description: Control for representation-map-strings-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-strings, ts-spread, ts-narrowing]
---*/
// Paired case: ../map-set-contents/representation-map-strings-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(text: string): void {
  const map = new Map<string, string>();
  map.set("first", text); map.set("second", text + "!");
  const reader: Map<string, string> = map;
  const value = reader.get("first");
  assert.sameValue(typeof value, "string");
  if (typeof value !== "string") throw new Test262Error("string required");
  assert.sameValue(value, text);
  assert.sameValue(value.length, text.length);
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["first", "second"]);
  assert.compareArray<unknown>([...reader.values()], [text, text + "!"]);
}
for (const text of ["", "7", "\u0000\u03b4", "\ud83c\udf31"]) check(text);
