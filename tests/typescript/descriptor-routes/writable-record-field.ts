/*---
description: A Record stored in a class field enforces individual writable flags without restricting its other properties.
features: [ts-descriptor-route-writability, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-record, ts-type-aliases, ts-interfaces, ts-class, ts-class-fields, ts-spread, ts-strings]
---*/
// A class field carries a numeric Record to integer-like and string-key writes; node blocks only the selected non-writable property and preserves key order and neighboring writes.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
type Target = Record<string, number>;
class Holder { values: Target; constructor(value: number) { this.values = { free: value }; } }
function install(target: Target, key: string, value: number, writable: boolean): Target { return Object.defineProperty(target, key, { value, writable, enumerable: true, configurable: true }); }
function write(target: Target, key: string, value: number): void { target[key] = value; }
function read(target: Target, key: string): number { return target[key]; }
function describe(target: Target, key: string): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(target, key); }
function names(target: Target): string[] { return Object.getOwnPropertyNames(target); }
for (const input of [-0, NaN, 17]) for (const key of ["10", "2", "name"]) for (const writable of [false, true]) {
  const holder = new Holder(input), target: Target = holder.values; assert.compareArray(names(target), ["free"]);
  same(install(target, key, input, writable), target); check(describe(target, key), input, writable, true, true); check(describe(target, "free"), input, true, true, true);
  if (writable) { write(target, key, 23); same(read(target, key), 23); }
  else { assert.throws(TypeError, () => write(target, key, 23)); same(read(target, key), input); check(describe(target, key), input, false, true, true); }
  write(target, "free", 31); same(read(holder.values, "free"), 31); same(read(holder.values, key), writable ? 23 : input);
  check(describe(target, key), writable ? 23 : input, writable, true, true); check(describe(target, "free"), 31, true, true, true);
  assert.compareArray(names(target), key === "name" ? ["free", "name"] : [key, "free"]);
}
