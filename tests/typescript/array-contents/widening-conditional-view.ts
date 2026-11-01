/*---
description: A conditional union view selects numeric or string storage and changes only the selected array to the opposite representation.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Write through a conditional union alias; read both original concrete arrays; node preserves the actual elements, order and length.
function check(n: number, chooseNumbers: boolean): void {
  const text = "item:" + String(n);
  const numbers: number[] = [-0, n];
  const strings: string[] = ["keep", text];
  const writer: (number | string)[] = chooseNumbers ? numbers : strings;
  const replacement = chooseNumbers ? text + "!" : n + 7;
  writer[1] = replacement;
  assert.sameValue<unknown>(writer, chooseNumbers ? numbers : strings);
  assert.sameValue(numbers.length, 2);
  assert.sameValue(strings.length, 2);
  assert.compareArray<unknown>(numbers, [-0, chooseNumbers ? replacement : n]);
  assert.compareArray<unknown>(strings, ["keep", chooseNumbers ? text : replacement]);
  assert.compareArray(numbers.map(value => typeof value), ["number", chooseNumbers ? "string" : "number"]);
  assert.compareArray(strings.map(value => typeof value), ["string", chooseNumbers ? "string" : "number"]);
}
for (const n of [-2, 0, 7]) for (const chooseNumbers of [false, true]) check(n, chooseNumbers);
