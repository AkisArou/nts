/*---
description: A recursive Set variable preserves its self member and primitive member order.
features: [ts-structuredclone-route-collections, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-type-aliases, ts-unions, ts-numbers, ts-null-undefined, ts-map-set]
---*/
// A variable typed as a recursive Set carries empty, primitive and cyclic members; node preserves insertion order and the set self edge.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
type GraphSet = Set<number | undefined | GraphSet>;
function copySet(source: GraphSet): GraphSet { return structuredClone(source); }
for (const shape of [0, 1, 2]) {
  const source: GraphSet = new Set();
  if (shape > 0) { source.add(-0); source.add(NaN); source.add(undefined); }
  if (shape === 2) source.add(source);
  const result = copySet(source); fresh(result, source, Set.prototype, []);
  const members = Array.from(result); same(result.size, shape === 0 ? 0 : shape === 1 ? 3 : 4);
  if (shape > 0) { same(members[0], 0); same(members[1], NaN); same(members[2], undefined); }
  if (shape === 2) { same(members[3], result); same(result.has(source), false); }
  result.add(9); same(source.has(9), false); source.add(11); same(result.has(11), false);
  if (shape === 2) { same(source.has(source), true); same(result.has(result), true); }
}
