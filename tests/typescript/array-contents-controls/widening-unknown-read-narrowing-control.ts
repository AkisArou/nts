/*---
description: Control for widening-unknown-read-narrowing; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-unknown, ts-narrowing, ts-numbers, ts-strings]
---*/
// Paired case: ../array-contents/widening-unknown-read-narrowing.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
function check(n: number): void {
  const text = "item:" + String(n);
  const xs: (number | string)[] = [n, text];
  const reader: (number | string)[] = xs;
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
