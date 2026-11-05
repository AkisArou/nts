/*---
description: "Set spread keeps insertion order and unique element identities in a copy unaffected by later additions. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-objects, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-map-set, ts-readonly, ts-tuples, ts-destructuring, ts-spread]
---*/

function localSpread<T>(source: Iterable<T>): T[] {
  const result: T[] = [];
  for (const value of source) result[result.length] = value;
  return result;
}
// Set spread keeps insertion order and unique element identities in a copy unaffected by later additions. Route: a private Set field initialized from declared union values. Node prints construction-spread-set-private-field:ok.
type SpreadValue = number | string | null | undefined | { id: number };
const marker = { id: 7 };
class SpreadReader {
  #values: Set<SpreadValue>; constructor(values: readonly SpreadValue[]) { this.#values = new Set(values); }
  read(): Set<SpreadValue> { return this.#values; }
  add(value: SpreadValue): void { this.#values.add(value); }
}
const rows: readonly [readonly SpreadValue[], readonly SpreadValue[]][] = [
  [[], []], [[marker, marker], [marker]],
  [[marker, "set", marker, -0, 0, null, undefined], [marker, "set", 0, null, undefined]]
];
for (const [input, expected] of rows) {
  const reader = new SpreadReader(input), result = localSpread(reader.read());
  assert.compareArray(result, expected);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(result[i], expected[i]), true);
  if (result.length > 0) assert.sameValue(result[0] === marker, true);
  reader.add("later");
  assert.compareArray(result, expected); assert.sameValue(reader.read().size, expected.length + 1);
}
console.log("construction-spread-set-private-field:ok");
