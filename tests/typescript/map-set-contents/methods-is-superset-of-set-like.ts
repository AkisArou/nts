/*---
description: isSupersetOf reads widened contents through a narrow Set receiver with a typed set-like operand.
features: [ts-map-set-contents, ts-contents-set-methods, ts-map-set, ts-unions, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-typeof-operator, ts-spread, ts-arrow-functions, ts-type-aliases, ts-class, ts-class-fields]
---*/
// Write: a union alias adds a string; read: narrow Set.isSupersetOf with a set-like operand.
// Node keeps string membership distinct from numeric twins, including zero.
type Item = number | string;
class Other {
  readonly values: Set<Item>;
  readonly size: number;
  hasCalls: number = 0;
  keysCalls: number = 0;
  constructor(values: Item[]) { this.values = new Set(values); this.size = this.values.size; }
  has(value: Item): boolean { this.hasCalls++; return this.values.has(value); }
  keys(): Iterator<Item> { this.keysCalls++; return this.values.keys(); }
}
function check(n: number, mode: number): void {
  const text = String(n);
  const left = new Set<number>([NaN, -0, n]);
  const writer: Set<Item> = left;
  writer.add(text);
  const choices: Item[][] = [[text, NaN], [text, n + 1, NaN, n + 2, n + 3],
    [text, NaN, -0, n], [n + 10, "other:" + text], [text, NaN, n, -0, n + 1], ["0"]];
  const other = new Other(choices[mode]);
  const result = left.isSupersetOf(other);
  const answers: boolean[] = [true, false, true, false, false, false];
  assert.sameValue(result, answers[mode]);
  assert.sameValue(typeof result, "boolean");
  assert.sameValue(other.hasCalls, [0, 0, 0, 0, 0, 0][mode]);
  assert.sameValue(other.keysCalls, [1, 0, 1, 1, 0, 1][mode]);
  assert.sameValue(left.size, 4);
  assert.sameValue(other.size, choices[mode].length);
  assert.compareArray<unknown>([...left], [NaN, 0, n, text]);
  assert.compareArray([...left].map(value => typeof value), ["number", "number", "number", "string"]);
}
for (const n of [1, 4, 11]) for (const mode of [0, 1, 2, 3, 4, 5]) check(n, mode);
