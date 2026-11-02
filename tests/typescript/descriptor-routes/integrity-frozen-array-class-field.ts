/*---
description: "A frozen array in a class field rejects push including no arguments index writes and length writes."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-type-aliases, ts-strings, ts-spread, ts-class, ts-class-fields, ts-function-types]
---*/
// A class field carries a frozen sparse number array; node rejects each push, index write and length assignment while preserving values, holes and descriptor flags.
type Target = number[];
function make(values: number[]): Target { return values.slice(); }
function names(value: Target): string[] { return Object.getOwnPropertyNames(value); }
function describe(value: Target, key: string): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, key); }
function state(value: Target): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }
function items(value: Target): number[] { return value.slice(); }
function size(value: Target): number { return value.length; }
function write(value: Target, index: number, next: number): void { value[index] = next; }
function resize(value: Target, next: number): void { value.length = next; }
function append(value: Target, next: number[]): number { return value.push(...next); }
class Shelf { items: Target; constructor(items: Target) { this.items = items; } }
function lockRoute(owner: Shelf): Target { Object.freeze(owner.items); return owner.items; }
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
