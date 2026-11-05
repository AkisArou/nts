/*---
description: "Pop follows a rebound captured array and reports every removed value and remaining prefix through exhaustion through a typed let captured by a closure. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

function localPop<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  const value = items[items.length - 1];
  items.length = items.length - 1;
  return value;
}
// Pop follows a rebound captured array and reports every removed value and remaining prefix through exhaustion; route: a typed let captured by a closure.
// Node prints writes-pop-captured-let-drain:ok.
type Item = number | string | { id: number } | undefined;
const marker: { id: number } = { id: 9 };
let items: Item[] = [];
const take: () => Item | undefined = () => localPop(items);
const rows: readonly [Item[], readonly Item[], readonly (readonly Item[])[]][] = [
  [[1, -0, NaN], [NaN, -0, 1, undefined], [[1, -0], [1], [], []]],
  [[marker, undefined, "tail"], ["tail", undefined, marker, undefined], [[marker, undefined], [marker], [], []]]
];
for (const [input, expected, remaining] of rows) {
  items = input;
  const result: Item[] = [];
  for (let i = 0; i < expected.length; i++) {
    result[result.length] = take();
    assert.compareArray(items, remaining[i]);
  }
  assert.compareArray(result, expected);
  assert.sameValue(items === input, true);
  assert.compareArray(input, []);
}
console.log("writes-pop-captured-let-drain:ok");
