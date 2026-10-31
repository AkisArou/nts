/*---
description: Control for methods-is-subset-of-set; every Set element uses the declared union type.
features: [ts-map-set-contents, ts-contents-set-methods, ts-map-set, ts-unions, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-typeof-operator, ts-spread, ts-arrow-functions, ts-type-aliases]
---*/
// Paired case: ../map-set-contents/methods-is-subset-of-set.ts.
// Only the receiver's declared element type changes; data, operations and checks stay identical.
type Item = number | string;
function check(n: number, mode: number): void {
  const text = String(n);
  const left = new Set<Item>([NaN, -0, n]);
  const writer: Set<Item> = left;
  writer.add(text);
  const choices: Item[][] = [[text, NaN], [text, n + 1, NaN, n + 2, n + 3],
    [text, NaN, -0, n], [n + 10, "other:" + text], [text, NaN, n, -0, n + 1], [NaN, 0, n, n + 1]];
  const other = new Set<Item>(choices[mode]);
  const result = left.isSubsetOf(other);
  const answers: boolean[] = [false, false, true, false, true, false];
  assert.sameValue(result, answers[mode]);
  assert.sameValue(typeof result, "boolean");
  assert.sameValue(left.size, 4);
  assert.sameValue(other.size, choices[mode].length);
  assert.compareArray<unknown>([...left], [NaN, 0, n, text]);
  assert.compareArray([...left].map(value => typeof value), ["number", "number", "number", "string"]);
}
for (const n of [1, 4, 11]) for (const mode of [0, 1, 2, 3, 4, 5]) check(n, mode);
