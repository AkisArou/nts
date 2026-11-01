/*---
description: Control for widening-generic-writer-instantiations; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Paired case: ../array-contents/widening-generic-writer-instantiations.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
function writeArray(xs: (number | string)[], value: number | string): void { xs[1] = value; xs.push(value); }
function check(n: number): void {
  const numbers: (number | string)[] = [-0, NaN];
  const strings: (number | string)[] = ["keep", "replace"];
  const text = "item:" + String(n);
  writeArray(numbers, n);
  writeArray(strings, text);
  assert.sameValue<unknown>(numbers[1], n);
  assert.sameValue(typeof numbers[1], "number");
  assert.sameValue<unknown>(strings[1], text);
  assert.sameValue(typeof strings[1], "string");
  assert.sameValue(numbers.length, 3);
  assert.sameValue(strings.length, 3);
  assert.compareArray<unknown>(numbers, [-0, n, n]);
  assert.compareArray<unknown>(strings, ["keep", text, text]);
  assert.compareArray(numbers.map(value => typeof value), ["number", "number", "number"]);
  assert.compareArray(strings.map(value => typeof value), ["string", "string", "string"]);
}
for (const n of [-0, NaN, 2147483649]) check(n);
