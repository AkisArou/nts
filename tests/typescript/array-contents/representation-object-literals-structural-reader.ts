/*---
description: A structural reader widens a stored object field while retaining literal identity, order and live payloads.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-objects, ts-structural-typing, ts-numbers, ts-strings]
---*/
// Concrete writes cross a wider reader; node keeps exact values, runtime kinds and slot presence.
function check(n: number): void {
  const first = { value: n, label: "first:" + n }, second = { label: "second:" + n, value: n };
  const values: { value: number; label: string }[] = [];
  values.push(first, second, first);
  const reader: readonly { value: unknown; label: string }[] = values;
  first.value = n + 10; first.label += "!";
  assert.sameValue(reader.length, 3);
  assert.compareArray(reader, [first, second, first]); assert.notSameValue(reader[0], reader[1]);
  for (let i = 0; i < reader.length; i++) {
    assert.sameValue(typeof reader[i], "object");
    assert.sameValue(reader[i].value, i === 1 ? n : n + 10); assert.sameValue(typeof reader[i].value, "number");
    assert.sameValue(reader[i].label, i === 1 ? "second:" + n : "first:" + n + "!");
    assert.sameValue(typeof reader[i].label, "string");
    assert.sameValue(Object.hasOwn(reader, i), true); assert.sameValue(i in reader, true);
  }
}
for (const n of [-2, 0, 9]) check(n);
