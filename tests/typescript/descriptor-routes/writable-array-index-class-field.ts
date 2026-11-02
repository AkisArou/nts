/*---
description: An array held in a class field can have one non-writable index while its other indices and length remain writable.
features: [ts-descriptor-route-writability, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-type-aliases, ts-class, ts-class-fields, ts-interfaces, ts-record, ts-spread, ts-strings]
---*/
// A number[] class field carries empty and populated arrays to an index descriptor; node blocks that index but permits a neighboring write and push with the ordinary length descriptor.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
type Target = number[];
class Holder { items: Target; constructor(values: number[]) { this.items = values.slice(); } }
function install(target: Target, value: number): Target { return Object.defineProperty(target, "0", { value, writable: false, enumerable: true, configurable: true }); }
function write(target: Target, index: number, value: number): void { target[index] = value; }
function read(target: Target, index: number): number { return target[index]; }
function size(target: Target): number { return target.length; }
function push(target: Target, value: number): number { return target.push(value); }
function describe(target: Target, key: string): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(target, key); }
function names(target: Target): string[] { return Object.getOwnPropertyNames(target); }
function contents(target: Target): number[] { return target.slice(); }
for (const input of [-0, NaN, 17]) for (const length of [0, 1, 2]) {
  const values: number[] = []; for (let i = 0; i < length; i++) values.push(input);
  const holder = new Holder(values), target: Target = holder.items; assert.compareArray(contents(target), values);
  same(install(target, input), target); same(read(target, 0), input); same(size(target), length === 0 ? 1 : length); check(describe(target, "0"), input, false, true, true);
  assert.throws(TypeError, () => write(holder.items, 0, 23)); same(read(target, 0), input); check(describe(target, "0"), input, false, true, true);
  write(holder.items, 1, 23); same(read(target, 1), 23); same(push(holder.items, 31), 3); assert.compareArray(contents(target), [input, 23, 31]);
  check(describe(target, "0"), input, false, true, true); check(describe(target, "1"), 23, true, true, true); check(describe(target, "2"), 31, true, true, true); check(describe(target, "length"), 3, true, false, false);
  assert.compareArray(names(target), ["0", "1", "2", "length"]); assert.compareArray(values, length === 0 ? [] : length === 1 ? [input] : [input, input]);
}
