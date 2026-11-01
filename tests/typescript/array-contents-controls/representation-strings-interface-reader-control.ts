/*---
description: Control for representation-strings-interface-reader; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-strings, ts-interfaces, ts-objects]
---*/
// Only reader declarations change; inputs, writes, reads and assertions are identical.
interface ArrayContentsStringView { values: string[]; }
function check(text: string): void {
  const values: string[] = [];
  const view: ArrayContentsStringView = { values };
  values.push(text, text + "\0", text + "\ud800", "\ud83d\udca1" + text);
  assert.sameValue(view.values.length, 4);
  assert.compareArray(view.values, [text, text + "\0", text + "\ud800", "\ud83d\udca1" + text]);
  for (let i = 0; i < view.values.length; i++) {
    assert.sameValue(typeof view.values[i], "string");
    assert.sameValue(Object.hasOwn(view.values, i), true); assert.sameValue(i in view.values, true);
  }
}
for (const text of ["", "a", "\u00e9"]) check(text);
