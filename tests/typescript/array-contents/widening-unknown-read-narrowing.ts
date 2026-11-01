/*---
description: Elements read through unknown[] narrow by their actual numeric or string type before further operations.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-unknown, ts-narrowing, ts-numbers, ts-strings]
---*/
// Write a union array; read through unknown[] and truthfully narrow each element; node preserves the actual elements, order and length.
function check(n: number): void {
  const text = "item:" + String(n);
  const xs: (number | string)[] = [n, text];
  const reader: unknown[] = xs;
  const seen: unknown[] = [], types: string[] = [];
  for (const index of [0, 1]) {
    const value = reader[index];
    seen.push(value); types.push(typeof value);
    if (typeof value === "number") {
      assert.sameValue(value, n);
      assert.sameValue(value + 1, n + 1);
    } else if (typeof value === "string") {
      assert.sameValue(value, text);
      assert.sameValue(value + "!", text + "!");
    } else throw new Error("Unexpected array element type");
  }
  assert.sameValue(reader.length, 2);
  assert.compareArray(seen, [n, text]);
  assert.compareArray(types, ["number", "string"]);
}
for (const n of [-0, NaN, 2147483649]) check(n);
