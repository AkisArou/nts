/*---
description: "Reverse changes the original array in exact order and returns it for empty single and longer numeric inputs through a private array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-numbers]
---*/

function localReverse<T>(items: T[]): T[] {
  for (let first = 0, last = items.length - 1; first < last; first++, last--) {
    const value = items[first];
    items[first] = items[last];
    items[last] = value;
  }
  return items;
}
// Reverse changes the original array in exact order and returns it for empty single and longer numeric inputs; route: a private array field.
// Node prints writes-reverse-private-field-values:ok.
class ReverseBox {
  #items: number[];
  constructor(items: number[]) { this.#items = items; }
  turn(): number[] { return localReverse(this.#items); }
  read(): readonly number[] { return this.#items; }
}
const rows: readonly [number[], readonly number[]][] = [[[], []], [[-0], [-0]], [[1, -0, NaN, 5], [5, NaN, -0, 1]]];
for (const [input, expected] of rows) {
  const box: ReverseBox = new ReverseBox(input), before: number[] = [];
  for (const value of input) before[before.length] = value;
  const result = box.turn();
  assert.sameValue(result === input, true);
  assert.sameValue(box.read() === input, true);
  assert.compareArray(input, expected);
  for (let i = 0; i < expected.length; i++) if (Object.is(expected[i], -0)) assert.sameValue(Object.is(result[i], -0), true);
  const restored = box.turn();
  assert.sameValue(restored === input, true);
  assert.compareArray(input, before);
}
console.log("writes-reverse-private-field-values:ok");
