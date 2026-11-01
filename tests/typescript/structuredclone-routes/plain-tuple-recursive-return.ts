/*---
description: A recursive optional tuple return preserves holes, length, aliases and cycles.
features: [ts-structuredclone-route-plain-data, ts-functions, ts-iteration, ts-arrays, ts-map-set, ts-objects, ts-unknown, ts-numbers, ts-null-undefined, ts-interfaces, ts-spread, ts-type-aliases, ts-tuples, ts-optional-properties]
---*/
// A declared optional tuple return carries empty, sparse and recursive tuples; node keeps lengths, absent indices, shared slots and back edges.
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
type CloneTuple = [value?: number, left?: CloneTuple, right?: CloneTuple];
function route(value: CloneTuple): CloneTuple { return value; }
function copyTuple(source: CloneTuple): CloneTuple { return structuredClone(source); }
function inspect(source: CloneTuple, result: CloneTuple, seen: Map<CloneTuple, CloneTuple>): void {
  const old = seen.get(source); if (old !== undefined) { same(result, old); return; }
  same(Array.from(seen.values()).includes(result), false); seen.set(source, result); same(Object.is(result, source), false);
  same(Object.getPrototypeOf(result), Array.prototype); same(result.length, source.length); assert.compareArray(Object.getOwnPropertyNames(result), Object.getOwnPropertyNames(source));
  for (const index of [0, 1, 2]) same(index in result, index in source); same(result[0], source[0]);
  if (source[1] === undefined) same(result[1], undefined); else { if (result[1] === undefined) throw new Error("left"); inspect(source[1], result[1], seen); }
  if (source[2] === undefined) same(result[2], undefined); else { if (result[2] === undefined) throw new Error("right"); inspect(source[2], result[2], seen); }
}
const inputs: CloneTuple[] = [[], [-0], [NaN], [undefined]];
const sparse: CloneTuple = []; sparse.length = 3; sparse[1] = undefined; inputs.push(sparse);
const shared: CloneTuple = [-0]; inputs.push([7, shared, shared], [7, [-0], [-0]]);
const graphSelf: CloneTuple = [NaN]; graphSelf[1] = graphSelf; inputs.push(graphSelf);
const first: CloneTuple = [], second: CloneTuple = [undefined]; first[1] = second; second[2] = first; inputs.push(first);
for (const input of inputs) {
  const source = route(input), original = captureGraph(source), result = copyTuple(source), seen = new Map<CloneTuple, CloneTuple>(); assertOriginal(original); inspect(source, result, seen);
  for (const [before, after] of seen) { for (const original of seen.keys()) same(Object.is(after, original), false); }
  for (const [before, after] of seen) { const old = before[0]; after[0] = 91; same(before[0], old); before[0] = 37; same(after[0], 91); }
}
