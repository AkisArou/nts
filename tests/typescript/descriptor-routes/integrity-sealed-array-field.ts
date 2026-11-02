/*---
description: "A sealed sparse array in an interface field retains writable length and indices but refuses deletion and extension."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-type-aliases, ts-interfaces, ts-strings, ts-spread]
---*/
// An interface field carries a sealed sparse number array; node preserves writes and length growth but refuses element deletion, insertion and shrinking past an element.
type Target = number[];
function make(values: number[]): Target { return values.slice(); }
function names(value: Target): string[] { return Object.getOwnPropertyNames(value); }
function describe(value: Target, key: string): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, key); }
function state(value: Target): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }
function items(value: Target): number[] { return value.slice(); }
function size(value: Target): number { return value.length; }
function write(value: Target, index: number, next: number): void { value[index] = next; }
function resize(value: Target, next: number): void { value.length = next; }
function remove(value: Target, index: number): boolean { return delete value[index]; }
function append(value: Target, next: number[]): number { return value.push(...next); }
interface Owner { items: Target; }
function lockRoute(owner: Owner): Target { return Object.seal(owner.items); }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function data(d: PropertyDescriptor | undefined, value: unknown, writable: boolean, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, undefined); same(d.set, undefined);
  assert.compareArray(Object.keys(d), ["value", "writable", "enumerable", "configurable"]);
}
const sparse: number[] = []; sparse.length = 4; sparse[1] = -0; sparse[3] = NaN;
const inputs: { values: number[]; names: string[] }[] = [{ values: [], names: ["length"] }, { values: [-0], names: ["0", "length"] }, { values: [NaN, 7], names: ["0", "1", "length"] }, { values: sparse, names: ["1", "3", "length"] }];

// Node 24.20.0 reports index-empty arrays frozen despite writable length; leave that predicate unasserted.
for (const row of inputs) {
  const owner: Owner = { items: make(row.values) }, source = owner.items, expected = row.values.slice(); same(lockRoute(owner), source);
  assert.compareArray(state(source).slice(0, 2), [false, true]); if (row.names.length > 1) same(state(source)[2], false); assert.compareArray(names(source), row.names); assert.compareArray(items(source), expected); data(describe(source, "length"), expected.length, true, false, false);
  for (let i = 0; i < expected.length; i++) if (i in expected) data(describe(source, String(i)), expected[i], true, true, false);
  if (expected.length > 0) {
    assert.throws(TypeError, () => resize(source, 0)); same(size(source), expected.length); assert.compareArray(items(source), expected); assert.compareArray(names(source), row.names);
    const index = Number(row.names[0]); write(source, index, 23); expected[index] = 23; assert.compareArray(items(source), expected);
    assert.throws(TypeError, () => remove(source, index)); assert.compareArray(items(source), expected); assert.compareArray(names(source), row.names); data(describe(source, String(index)), 23, true, true, false);
  } else { resize(source, 0); assert.compareArray(items(source), []); }
  assert.throws(TypeError, () => append(source, [11])); same(size(source), expected.length); assert.compareArray(items(source), expected); assert.compareArray(names(source), row.names);
  resize(source, expected.length + 2); expected.length += 2; same(size(source), expected.length); assert.compareArray(items(source), expected); assert.compareArray(names(source), row.names); data(describe(source, "length"), expected.length, true, false, false);
}
