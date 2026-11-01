/*---
description: A recursive array variable preserves holes and distinguishes shared and distinct nested arrays.
features: [ts-structuredclone-route-plain-data, ts-functions, ts-iteration, ts-arrays, ts-map-set, ts-objects, ts-unknown, ts-numbers, ts-null-undefined, ts-interfaces, ts-spread, ts-type-aliases, ts-unions]
---*/
// A typed recursive array variable carries sparse arrays, scalar payloads, shared arrays and cycles; node copies each array once and retains every absent index.
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
type CloneArray = (number | undefined | CloneArray)[];
function copyArray(source: CloneArray): CloneArray { return structuredClone(source); }
function inspect(source: CloneArray, result: CloneArray, seen: Map<CloneArray, CloneArray>): void {
  const old = seen.get(source); if (old !== undefined) { same(result, old); return; }
  same(Array.from(seen.values()).includes(result), false); seen.set(source, result); same(Object.is(result, source), false);
  same(Object.getPrototypeOf(result), Array.prototype); same(result.length, source.length); assert.compareArray(Object.getOwnPropertyNames(result), Object.getOwnPropertyNames(source));
  for (let i = 0; i < source.length; i++) {
    same(i in result, i in source); const before = source[i], after = result[i];
    if (typeof before === "object") { if (typeof after !== "object" || after === null) throw new Error("array"); inspect(before, after, seen); } else same(after, before);
  }
}
const inputs: CloneArray[] = [[], [-0, NaN, undefined]];
const sparse: CloneArray = []; sparse.length = 5; sparse[1] = undefined; sparse[3] = -0; inputs.push(sparse);
const shared: CloneArray = [NaN]; inputs.push([7, shared, shared], [7, [NaN], [NaN]]);
const graphSelf: CloneArray = [-0]; graphSelf.push(graphSelf); inputs.push(graphSelf);
const first: CloneArray = [], second: CloneArray = [undefined]; first.push(second); second.push(first); inputs.push(first);
for (const input of inputs) {
  const source: CloneArray = input, original = captureGraph(source), result = copyArray(source), seen = new Map<CloneArray, CloneArray>(); assertOriginal(original); inspect(source, result, seen);
  for (const [before, after] of seen) { for (const original of seen.keys()) same(Object.is(after, original), false); }
  for (const [before, after] of seen) { const old = before[0]; after[0] = 91; same(before[0], old); before[0] = 37; same(after[0], 91); }
}
