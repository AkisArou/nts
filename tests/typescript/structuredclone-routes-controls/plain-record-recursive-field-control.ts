/*---
description: A handwritten recursive memoized copy controls A recursive Record field preserves key order, special values and alias structure.
features: [ts-structuredclone-route-plain-data, ts-functions, ts-iteration, ts-arrays, ts-map-set, ts-objects, ts-unknown, ts-numbers, ts-null-undefined, ts-interfaces, ts-spread, ts-record, ts-type-aliases, ts-unions, ts-strings]
---*/
// A Record<string, Value> field carries recursive dictionaries with numeric and string keys; node preserves each key sequence and shared or cyclic values.
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
type Value = number | undefined | Table;
interface Table extends Record<string, Value> {}
interface Holder { value: Record<string, Value>; }
function copyTable(source: Table, memory = new Map<Table, Table>()): Table {
  const old = memory.get(source); if (old !== undefined) return old;
  const result: Table = {}; memory.set(source, result);
  for (const key of Object.keys(source)) { const value = source[key]; result[key] = typeof value === "object" ? copyTable(value, memory) : value; }
  return result;
}
function inspect(source: Table, result: Table, seen: Map<Table, Table>): void {
  const old = seen.get(source); if (old !== undefined) { same(result, old); return; }
  same(Array.from(seen.values()).includes(result), false); seen.set(source, result); same(Object.is(result, source), false);
  same(Object.getPrototypeOf(result), Object.prototype); assert.compareArray(Object.keys(result), Object.keys(source));
  for (const key of Object.keys(source)) {
    const before = source[key], after = result[key];
    if (typeof before === "object") { if (typeof after !== "object" || after === null) throw new Error("table"); inspect(before, after, seen); } else same(after, before);
  }
}
const inputs: Table[] = [{}, { "10": NaN, "2": -0, "01": undefined, text: 7 }];
assert.compareArray(Object.keys(inputs[1]), ["2", "10", "01", "text"]);
const shared: Table = { n: -0 }; inputs.push({ a: shared, b: shared }, { a: { n: -0 }, b: { n: -0 } });
const graphSelf: Table = {}; graphSelf.self = graphSelf; inputs.push(graphSelf);
const first: Table = { n: NaN }, second: Table = { n: undefined }; first.next = second; second.next = first; inputs.push(first);
for (const input of inputs) {
  const holder: Holder = { value: input }, original = captureGraph(holder.value), result = copyTable(holder.value), seen = new Map<Table, Table>(); assertOriginal(original); inspect(holder.value, result, seen);
  for (const [before, after] of seen) { for (const original of seen.keys()) same(Object.is(after, original), false); }
  for (const [before, after] of seen) { const old = before.written; after.written = 91; same(before.written, old); before.written = 37; same(after.written, 91); }
}
