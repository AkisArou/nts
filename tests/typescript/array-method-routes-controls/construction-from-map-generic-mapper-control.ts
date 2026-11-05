/*---
description: "Array.from gives its mapper each Map entry and the insertion-order index while retaining value identity. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-strings, ts-map-set, ts-tuples, ts-destructuring, ts-arrow-functions]
---*/

function localFrom<T, U>(source: Iterable<T>, mapper: (value: T, index: number) => U): U[] {
  const result: U[] = []; let index = 0;
  for (const value of source) { result[index] = mapper(value, index); index++; }
  return result;
}
// Array.from gives its mapper each Map entry and the insertion-order index while retaining value identity. Route: a constrained helper at string and record type arguments. Node prints construction-from-map-generic-mapper:ok.
function inspect<T extends string | { id: number }>(first: T, second: T): void {
  const source: Map<string, T> = new Map([["left", first], ["right", second]]);
  const result = localFrom(source, ([key, value], index): [string, T, number] => [key, value, index]);
  assert.sameValue(result.length, 2);
  assert.compareArray(result[0], ["left", first, 0]);
  assert.compareArray(result[1], ["right", second, 1]);
  source.clear();
  assert.sameValue(result[0][1] === first, true); assert.sameValue(result[1][1] === second, true);
  assert.sameValue(source.size, 0);
}
inspect<string>("alpha", "beta");
const first = { id: 1 }, second = { id: 2 };
inspect<{ id: number }>(first, second);
console.log("construction-from-map-generic-mapper:ok");
