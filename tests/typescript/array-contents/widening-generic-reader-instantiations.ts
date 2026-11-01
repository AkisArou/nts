/*---
description: One generic reader preserves every element of independent numeric and string array instantiations.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-unknown, ts-numbers, ts-strings]
---*/
// Write concrete arrays; read through numeric and string instantiations of one generic reader; node preserves the actual elements, order and length.
function readArray<T>(xs: T[], index: number): T { return xs[index]; }
function check(n: number): void {
  const text = "item:" + String(n);
  const numbers: number[] = [-0, n, NaN];
  const strings: string[] = ["start", text, text + "!"];
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
