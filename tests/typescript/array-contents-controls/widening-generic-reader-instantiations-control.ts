/*---
description: Control for widening-generic-reader-instantiations; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-unknown, ts-numbers, ts-strings]
---*/
// Paired case: ../array-contents/widening-generic-reader-instantiations.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
function readArray(xs: (number | string)[], index: number): number | string { return xs[index]; }
function check(n: number): void {
  const text = "item:" + String(n);
  const numbers: (number | string)[] = [-0, n, NaN];
  const strings: (number | string)[] = ["start", text, text + "!"];
  const seenNumbers: unknown[] = [], seenStrings: unknown[] = [];
  const numberTypes: string[] = [], stringTypes: string[] = [];
  for (const index of [0, 1, 2]) {
    const numberValue = readArray(numbers, index);
    const stringValue = readArray(strings, index);
    seenNumbers.push(numberValue); seenStrings.push(stringValue);
    numberTypes.push(typeof numberValue); stringTypes.push(typeof stringValue);
  }
  assert.sameValue(numbers.length, 3);
  assert.sameValue(strings.length, 3);
  assert.compareArray(seenNumbers, [-0, n, NaN]);
  assert.compareArray(seenStrings, ["start", text, text + "!"]);
  assert.compareArray(numberTypes, ["number", "number", "number"]);
  assert.compareArray(stringTypes, ["string", "string", "string"]);
}
for (const n of [-0, NaN, 2147483649]) check(n);
