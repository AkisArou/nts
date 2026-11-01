/*---
description: A recursive Map in an interface field preserves cycles and scalar entries.
features: [ts-structuredclone-route-collections, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-interfaces, ts-type-aliases, ts-unions, ts-numbers, ts-null-undefined, ts-strings, ts-map-set]
---*/
// A field typed as a recursive Map carries empty, scalar and self-referential maps; node keeps order, special numbers and the self edge.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
type GraphMap = Map<string, number | undefined | GraphMap>;
interface MapHolder { value: GraphMap; }
function copyMap(source: GraphMap): GraphMap { return structuredClone(source); }
for (const shape of [0, 1, 2]) {
  const holder: MapHolder = { value: new Map() }, source = holder.value;
  if (shape > 0) { source.set("zero", -0); source.set("nan", NaN); source.set("absent", undefined); }
  if (shape === 2) source.set("self", source);
  const result = copyMap(holder.value); fresh(result, source, Map.prototype, []);
  assert.compareArray(Array.from(result.keys()), shape === 0 ? [] : shape === 1 ? ["zero", "nan", "absent"] : ["zero", "nan", "absent", "self"]);
  same(result.size, shape === 0 ? 0 : shape === 1 ? 3 : 4);
  if (shape > 0) { same(result.get("zero"), -0); same(result.get("nan"), NaN); same(result.get("absent"), undefined); }
  if (shape === 2) same(result.get("self"), result);
  result.set("zero", 9); same(source.get("zero"), shape === 0 ? undefined : -0);
  source.set("zero", 11); same(result.get("zero"), 9);
  same(source.has("nan"), shape > 0); if (shape === 2) same(source.get("self"), source);
}
