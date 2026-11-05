/*---
description: "Flat preserves exact depth boundaries at zero one two and Infinity while leaving all source levels unchanged through a private nested-array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-unions, ts-type-aliases, ts-tuples, ts-numbers]
---*/

type LocalFlatValue = number | string | null | undefined | { id: number } | readonly LocalFlatValue[];
function localFlat(items: readonly LocalFlatValue[], depth: number = 1): LocalFlatValue[] {
  const result: LocalFlatValue[] = [];
  function append(values: readonly LocalFlatValue[], level: number): void {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (level > 0 && typeof value === "object" && value !== null && !("id" in value)) append(value, level - 1);
      else result[result.length] = value;
    }
  }
  append(items, depth !== depth ? 0 : depth === Infinity ? depth : depth - depth % 1);
  return result;
}
// Flat preserves exact depth boundaries at zero one two and Infinity while leaving all source levels unchanged; route: a private nested-array field.
// Node prints copies-flat-private-field-depths:ok.
type LevelOne = number[];
type LevelTwo = (number | LevelOne)[];
type LevelThree = (number | LevelTwo)[];
type Nested = number | LevelThree;
const fourth: LevelOne = [4, 5], third: LevelTwo = [3, fourth], second: LevelThree = [2, third];
class FlatBox {
  #items: Nested[] = [1, second, 9];
  copy(depth: number): readonly unknown[] { return localFlat(this.#items, depth); }
  read(): readonly Nested[] { return this.#items; }
}
const box: FlatBox = new FlatBox();
const rows: readonly [number, readonly unknown[]][] = [[0, [1, second, 9]], [1, [1, 2, third, 9]], [2, [1, 2, 3, fourth, 9]], [Infinity, [1, 2, 3, 4, 5, 9]]];
for (const [depth, expected] of rows) {
  const result = box.copy(depth);
  assert.compareArray(result, expected);
  assert.sameValue(result === box.read(), false);
  assert.compareArray(box.read(), [1, second, 9]);
  assert.compareArray(second, [2, third]);
  assert.compareArray(third, [3, fourth]);
  assert.compareArray(fourth, [4, 5]);
}
console.log("copies-flat-private-field-depths:ok");
