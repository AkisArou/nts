/*---
description: "A nonextensible interface parameter retains data flags and permits writes and deletions but rejects additions."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-optional-properties, ts-null-undefined]
---*/
// An optional data interface crosses preventExtensions through a parameter; node preserves existing attributes, rejects additions and still allows deletion.
type Scalar = number | undefined;
interface Target { value?: Scalar; extra?: Scalar; }
function names(value: Target): string[] { return Object.getOwnPropertyNames(value); }
function describe(value: Target, key: keyof Target): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, key); }
function read(value: Target, key: keyof Target): Scalar { return value[key]; }
function write(value: Target, key: keyof Target, next: Scalar): void { value[key] = next; }
function remove(value: Target, key: keyof Target): boolean { return delete value[key]; }
function state(value: Target): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }
function make(present: boolean, n: Scalar): Target { return present ? { value: n } : {}; }
function lockRoute(value: Target): Target { return Object.preventExtensions(value); }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function data(d: PropertyDescriptor | undefined, value: unknown, writable: boolean, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, undefined); same(d.set, undefined);
  assert.compareArray(Object.keys(d), ["value", "writable", "enumerable", "configurable"]);
}
for (const n of [-0, NaN, undefined, 7]) for (const present of [false, true]) {
  const source: Target = make(present, n), expected = present ? ["value"] : []; assert.compareArray(state(source), [true, false, false]);
  same(lockRoute(source), source); assert.compareArray(state(source), [false, !present, !present]); assert.compareArray(names(source), expected);
  if (present) data(describe(source, "value"), n, true, true, true); else same(describe(source, "value"), undefined);
  assert.throws(TypeError, () => write(source, "extra", 11)); same(read(source, "extra"), undefined); same(read(source, "value"), present ? n : undefined); assert.compareArray(names(source), expected);
  if (present) { write(source, "value", 23); same(read(source, "value"), 23); data(describe(source, "value"), 23, true, true, true); }
  same(remove(source, "value"), true); same(read(source, "value"), undefined); same(describe(source, "value"), undefined); assert.compareArray(names(source), []);
  assert.compareArray(state(source), [false, true, true]);
  assert.throws(TypeError, () => write(source, "value", n)); same(read(source, "value"), undefined); same(describe(source, "value"), undefined); assert.compareArray(names(source), []);
}
