/*---
description: "A nonextensible array parameter permits length growth and existing writes while rejecting holes and new indices."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-type-aliases, ts-strings]
---*/
// A sparse number-array parameter reaches preventExtensions; node leaves length and existing elements writable but refuses to fill an absent index.
type Target = number[];
function make(values: number[]): Target { return values.slice(); }
function names(value: Target): string[] { return Object.getOwnPropertyNames(value); }
function describe(value: Target, key: string): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, key); }
function state(value: Target): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }
function items(value: Target): number[] { return value.slice(); }
function size(value: Target): number { return value.length; }
function write(value: Target, index: number, next: number): void { value[index] = next; }
function resize(value: Target, next: number): void { value.length = next; }
function lockRoute(value: Target): Target { return Object.preventExtensions(value); }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function data(d: PropertyDescriptor | undefined, value: unknown, writable: boolean, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, undefined); same(d.set, undefined);
  assert.compareArray(Object.keys(d), ["value", "writable", "enumerable", "configurable"]);
}
const sparse: number[] = []; sparse.length = 4; sparse[1] = -0; sparse[3] = NaN;
const inputs: { values: number[]; names: string[] }[] = [{ values: [], names: ["length"] }, { values: [-0], names: ["0", "length"] }, { values: [NaN, 7], names: ["0", "1", "length"] }, { values: sparse, names: ["1", "3", "length"] }];

// Node 24.20.0 reports index-empty arrays frozen despite writable length; leave that predicate unasserted.
for (const row of inputs) {
  const source: Target = make(row.values), expected = row.values.slice(); same(lockRoute(source), source);
  assert.compareArray(state(source).slice(0, 2), [false, row.names.length === 1]); if (row.names.length > 1) same(state(source)[2], false); assert.compareArray(names(source), row.names); assert.compareArray(items(source), expected);
  data(describe(source, "length"), expected.length, true, false, false);
  for (let i = 0; i < expected.length; i++) if (i in expected) data(describe(source, String(i)), expected[i], true, true, true);
  if (row.names[0] !== "length") { const index = Number(row.names[0]); write(source, index, 23); expected[index] = 23; assert.compareArray(items(source), expected); }
  const hole = expected.length; resize(source, expected.length + 2); expected.length += 2; same(size(source), expected.length); assert.compareArray(items(source), expected); assert.compareArray(names(source), row.names);
  assert.throws(TypeError, () => write(source, hole, 11)); same(describe(source, String(hole)), undefined); same(size(source), expected.length); assert.compareArray(items(source), expected); assert.compareArray(names(source), row.names);
  resize(source, 0); same(size(source), 0); assert.compareArray(items(source), []); assert.compareArray(names(source), ["length"]); data(describe(source, "length"), 0, true, false, false);
  assert.compareArray(state(source).slice(0, 2), [false, true]);
}
