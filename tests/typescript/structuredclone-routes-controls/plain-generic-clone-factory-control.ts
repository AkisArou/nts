/*---
description: A handwritten recursive memoized copy controls A constrained generic clone factory preserves optional recursive interface graphs.
features: [ts-structuredclone-route-plain-data, ts-functions, ts-iteration, ts-arrays, ts-map-set, ts-objects, ts-unknown, ts-numbers, ts-null-undefined, ts-interfaces, ts-spread, ts-optional-properties, ts-generics, ts-generic-constraints, ts-function-types, ts-arrow-functions]
---*/
// A factory instantiated with Graph returns a typed clone callback; node preserves empty data, special values, separate or shared children and cycles.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
interface CloneSnapshot { keys: string[]; names: string[]; values: unknown[]; prototype: unknown; length: unknown; }
function captureGraph(value: unknown, seen = new Map<object, CloneSnapshot>()): Map<object, CloneSnapshot> {
  if (typeof value !== "object" || value === null || seen.has(value)) return seen;
  const values = Object.values<unknown>({ ...value }); seen.set(value, { keys: Object.keys(value), names: Object.getOwnPropertyNames(value), values, prototype: Object.getPrototypeOf(value), length: "length" in value ? value.length : undefined });
  for (const child of values) captureGraph(child, seen); return seen;
}
function assertOriginal(seen: Map<object, CloneSnapshot>): void {
  for (const [value, state] of seen) {
    assert.compareArray(Object.keys(value), state.keys); assert.compareArray(Object.getOwnPropertyNames(value), state.names); assert.compareArray(Object.values<unknown>({ ...value }), state.values);
    same(Object.getPrototypeOf(value), state.prototype); same("length" in value ? value.length : undefined, state.length);
  }
}
interface Graph { value?: number; left?: Graph; right?: Graph; }
function copyGraph(source: Graph, memory = new Map<Graph, Graph>()): Graph {
  const old = memory.get(source); if (old !== undefined) return old;
  const result: Graph = {}; memory.set(source, result);
  for (const key of Object.keys(source)) {
    if (key === "value") result.value = source.value;
    else if (key === "left") result.left = source.left === undefined ? undefined : copyGraph(source.left, memory);
    else if (key === "right") result.right = source.right === undefined ? undefined : copyGraph(source.right, memory);
  } return result;
}
function factory<T extends Graph>(): (source: T) => Graph { return source => copyGraph(source); }
function inspect(source: Graph, result: Graph, seen: Map<Graph, Graph>): void {
  const old = seen.get(source); if (old !== undefined) { same(result, old); return; }
  same(Array.from(seen.values()).includes(result), false); seen.set(source, result); same(Object.is(result, source), false);
  same(Object.getPrototypeOf(result), Object.prototype); assert.compareArray(Object.keys(result), Object.keys(source)); same(result.value, source.value);
  if (source.left === undefined) same(result.left, undefined); else { if (result.left === undefined) throw new Error("left"); inspect(source.left, result.left, seen); }
  if (source.right === undefined) same(result.right, undefined); else { if (result.right === undefined) throw new Error("right"); inspect(source.right, result.right, seen); }
}
const inputs: Graph[] = [{}, { value: -0 }, { value: NaN }, { value: undefined }];
const shared: Graph = { value: 7 }; inputs.push({ left: shared, right: shared }, { left: { value: 7 }, right: { value: 7 } });
const graphSelf: Graph = { value: -0 }; graphSelf.left = graphSelf; inputs.push(graphSelf);
const first: Graph = { value: NaN }, second: Graph = {}; first.left = second; second.right = first; inputs.push(first);
const copy = factory<Graph>();
for (const source of inputs) {
  const original = captureGraph(source), result = copy(source), seen = new Map<Graph, Graph>(); assertOriginal(original); inspect(source, result, seen);
  for (const [before, after] of seen) { for (const original of seen.keys()) same(Object.is(after, original), false); }
  for (const [before, after] of seen) { const value = before.value; after.value = 91; same(before.value, value); before.value = 37; same(after.value, 91); }
}
