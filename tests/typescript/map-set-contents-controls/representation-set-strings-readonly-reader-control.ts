/*---
description: Control for representation-set-strings-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-strings, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/representation-set-strings-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(text: string): void {
  const set = new Set<string>();
  set.add(text); set.add(text + "!"); set.add(text);
  const reader: Set<string> = set;
  assert.sameValue(reader.size, 2);
  assert.sameValue(reader.has(text), true);
  assert.compareArray<unknown>([...reader], [text, text + "!"]);
  assert.compareArray([...reader].map(value => typeof value), ["string", "string"]);
}
for (const text of ["", "7", "\u0000\u03b4", "\ud83c\udf31"]) check(text);
