/*---
description: Plain flag-record control for An array held in a class field can have one non-writable index while its other indices and length remain writable.
features: [ts-descriptor-route-writability, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-type-aliases, ts-class, ts-class-fields, ts-interfaces, ts-record, ts-spread, ts-strings]
---*/
// A number[] class field carries empty and populated arrays to an index descriptor; node blocks that index but permits a neighboring write and push with the ordinary length descriptor.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value: number; writable: boolean; enumerable: boolean; configurable: boolean; }
interface Target { cells: Record<string, Cell>; }
class Holder { items: Target; constructor(values: number[]) { this.items = { cells: { length: { value: values.length, writable: true, enumerable: false, configurable: false } } }; for (let i = 0; i < values.length; i++) this.items.cells[String(i)] = { value: values[i], writable: true, enumerable: true, configurable: true }; } }
function install(target: Target, value: number): Target { target.cells["0"] = { value, writable: false, enumerable: true, configurable: true }; if (target.cells.length.value === 0) target.cells.length.value = 1; return target; }
function write(target: Target, index: number, value: number): void { const key = String(index), d = target.cells[key], length = target.cells.length; if (d !== undefined && !d.writable || index >= length.value && !length.writable) throw new TypeError("write"); if (d === undefined) target.cells[key] = { value, writable: true, enumerable: true, configurable: true }; else d.value = value; if (index >= length.value) length.value = index + 1; }
function read(target: Target, index: number): number { return target.cells[String(index)].value; }
function size(target: Target): number { return target.cells.length.value; }
function push(target: Target, value: number): number { write(target, size(target), value); return size(target); }
function describe(target: Target, key: string): PropertyDescriptor | undefined { const d = target.cells[key]; return d === undefined ? undefined : { ...d }; }
function names(target: Target): string[] { return Object.keys(target.cells); }
function contents(target: Target): number[] { const values: number[] = []; for (let i = 0; i < size(target); i++) values.push(read(target, i)); return values; }
for (const input of [-0, NaN, 17]) for (const length of [0, 1, 2]) {
  const values: number[] = []; for (let i = 0; i < length; i++) values.push(input);
  const holder = new Holder(values), target: Target = holder.items; assert.compareArray(contents(target), values);
  same(install(target, input), target); same(read(target, 0), input); same(size(target), length === 0 ? 1 : length); check(describe(target, "0"), input, false, true, true);
  assert.throws(TypeError, () => write(holder.items, 0, 23)); same(read(target, 0), input); check(describe(target, "0"), input, false, true, true);
  write(holder.items, 1, 23); same(read(target, 1), 23); same(push(holder.items, 31), 3); assert.compareArray(contents(target), [input, 23, 31]);
  check(describe(target, "0"), input, false, true, true); check(describe(target, "1"), 23, true, true, true); check(describe(target, "2"), 31, true, true, true); check(describe(target, "length"), 3, true, false, false);
  assert.compareArray(names(target), ["0", "1", "2", "length"]); assert.compareArray(values, length === 0 ? [] : length === 1 ? [input] : [input, input]);
}
