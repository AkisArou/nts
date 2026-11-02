/*---
description: "Explicit property-flag control: A frozen array in a class field rejects push including no arguments index writes and length writes."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-type-aliases, ts-strings, ts-spread, ts-class, ts-class-fields, ts-function-types, ts-record, ts-interfaces]
---*/
// A class field carries a frozen sparse number array; node rejects each push, index write and length assignment while preserving values, holes and descriptor flags.
interface Slot { value: number; writable: boolean; enumerable: boolean; configurable: boolean; }
interface Target { fields: Record<string, Slot>; extensible: boolean; }
function make(values: number[]): Target {
  const fields: Record<string, Slot> = { length: { value: values.length, writable: true, enumerable: false, configurable: false } };
  for (let i = 0; i < values.length; i++) if (i in values) fields[String(i)] = { value: values[i], writable: true, enumerable: true, configurable: true }; return { fields, extensible: true };
}
function names(value: Target): string[] { return Object.keys(value.fields); }
function describe(value: Target, key: string): PropertyDescriptor | undefined { const d = value.fields[key]; return d === undefined ? undefined : { value: d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable }; }
function state(value: Target): boolean[] { const cells = Object.values(value.fields); return [value.extensible, !value.extensible && cells.every(d => !d.configurable), !value.extensible && cells.every(d => !d.configurable && !d.writable)]; }
function items(value: Target): number[] { const result: number[] = []; result.length = size(value); for (let i = 0; i < result.length; i++) { const d = value.fields[String(i)]; if (d !== undefined) result[i] = d.value; } return result; }
function size(value: Target): number { return value.fields.length.value; }
function write(value: Target, index: number, next: number): void { const d = value.fields[String(index)], length = value.fields.length; if (d === undefined) { if (!value.extensible || index >= length.value && !length.writable) throw new TypeError(); value.fields[String(index)] = { value: next, writable: true, enumerable: true, configurable: true }; } else { if (!d.writable) throw new TypeError(); d.value = next; } if (index >= length.value) length.value = index + 1; }
function resize(value: Target, next: number): void { const length = value.fields.length; if (!length.writable) throw new TypeError(); for (let i = length.value - 1; i >= next; i--) { const d = value.fields[String(i)]; if (d !== undefined && !d.configurable) { length.value = i + 1; throw new TypeError(); } delete value.fields[String(i)]; } length.value = next; }
function append(value: Target, next: number[]): number { let length = size(value); for (const item of next) write(value, length++, item); resize(value, length); return length; }
class Shelf { items: Target; constructor(items: Target) { this.items = items; } }
function lockRoute(owner: Shelf): Target { const value = owner.items; value.extensible = false; for (const key of names(value)) { value.fields[key].writable = false; value.fields[key].configurable = false; } return value; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function data(d: PropertyDescriptor | undefined, value: unknown, writable: boolean, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, undefined); same(d.set, undefined);
  assert.compareArray(Object.keys(d), ["value", "writable", "enumerable", "configurable"]);
}
function unchanged(value: Target, expected: number[], keys: string[]): void {
  assert.compareArray(items(value), expected); same(size(value), expected.length); assert.compareArray(names(value), keys); assert.compareArray(state(value), [false, true, true]);
  data(describe(value, "length"), expected.length, false, false, false); for (let i = 0; i < expected.length; i++) if (i in expected) data(describe(value, String(i)), expected[i], false, true, false);
}

const sparse: number[] = []; sparse.length = 4; sparse[1] = -0; sparse[3] = NaN;
const inputs: { values: number[]; names: string[] }[] = [{ values: [], names: ["length"] }, { values: [-0], names: ["0", "length"] }, { values: [NaN, 7], names: ["0", "1", "length"] }, { values: sparse, names: ["1", "3", "length"] }];

for (const row of inputs) {
  const owner: Shelf = new Shelf(make(row.values)), source = owner.items, expected = row.values.slice(); same(lockRoute(owner), source); unchanged(source, expected, row.names);
  const refused: (() => unknown)[] = [() => append(source, [11]), () => append(source, []), () => write(source, 0, 11), () => resize(source, expected.length), () => resize(source, expected.length + 1), () => resize(source, 0)];
  for (const operation of refused) { assert.throws(TypeError, operation); unchanged(source, expected, row.names); }
}
