/*---
description: union reads widened contents through a narrow Set receiver with a typed set operand.
features: [ts-map-set-contents, ts-contents-set-methods, ts-map-set, ts-unions, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-typeof-operator, ts-spread, ts-arrow-functions, ts-type-aliases]
---*/
// Write: a union alias adds a string; read: narrow Set.union with a set operand.
// Node preserves kinds, canonical zero, NaN and the method's size-dependent order.
type Item = number | string;
function check(n: number, mode: number): void {
  const text = String(n);
  const left = new Set<number>([NaN, -0, n]);
  const writer: Set<Item> = left;
  writer.add(text);
  const choices: Item[][] = [[text, NaN], [text, n + 1, NaN, n + 2, n + 3],
    [text, NaN, -0, n], [n + 10, "other:" + text], [text, NaN, n, -0, n + 1]];
  const other = new Set<Item>(choices[mode]);
  const result = left.union(other);
  const answers: Item[][] = [[NaN, 0, n, text], [NaN, 0, n, text, n + 1, n + 2, n + 3],
    [NaN, 0, n, text], [NaN, 0, n, text, n + 10, "other:" + text], [NaN, 0, n, text, n + 1]];
  const expected = answers[mode];
  assert.compareArray<unknown>([...result], expected);
  assert.compareArray([...result].map(value => typeof value), expected.map(value => typeof value));
  assert.sameValue(result.size, expected.length);
  assert.sameValue(left.size, 4);
  assert.sameValue(other.size, choices[mode].length);
  assert.compareArray<unknown>([...left], [NaN, 0, n, text]);
  assert.compareArray([...left].map(value => typeof value), ["number", "number", "number", "string"]);
}
for (const n of [1, 4, 11]) for (const mode of [0, 1, 2, 3, 4]) check(n, mode);
