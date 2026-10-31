/*---
description: An unknown-element readonly Set view retains complete distinct strings in insertion order.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-strings, ts-spread, ts-arrow-functions]
---*/
// Write: Set<string>.add; read: a readonly unknown-element view.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(text: string): void {
  const set = new Set<string>();
  set.add(text); set.add(text + "!"); set.add(text);
  const reader: ReadonlySet<unknown> = set;
  assert.sameValue(reader.size, 2);
  assert.sameValue(reader.has(text), true);
  assert.compareArray<unknown>([...reader], [text, text + "!"]);
  assert.compareArray([...reader].map(value => typeof value), ["string", "string"]);
}
for (const text of ["", "7", "\u0000\u03b4", "\ud83c\udf31"]) check(text);
