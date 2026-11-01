/*---
description: One generic writer preserves numeric and string array instantiations during replacement and growth.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Write through two instantiations of the same generic function; read each concrete array; node preserves the actual elements, order and length.
function writeArray<T>(xs: T[], value: T): void { xs[1] = value; xs.push(value); }
function check(n: number): void {
  const numbers: number[] = [-0, NaN];
  const strings: string[] = ["keep", "replace"];
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
