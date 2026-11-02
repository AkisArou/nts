/*---
description: "A frozen Record return exposes nonwritable nonconfigurable fields in numeric and string key order."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-record, ts-type-aliases, ts-strings, ts-null-undefined]
---*/
// A Record return carries an empty or mixed-key object after freeze; node retains every value and rejects existing writes, deletion and additions.
type Scalar = number | undefined;
type Target = Record<string, Scalar>;
function names(value: Target): string[] { return Object.getOwnPropertyNames(value); }
function describe(value: Target, key: string): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, key); }
function read(value: Target, key: string): Scalar { return value[key]; }
function write(value: Target, key: string, next: Scalar): void { value[key] = next; }
function remove(value: Target, key: string): boolean { return delete value[key]; }
function state(value: Target): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }
function make(full: boolean, n: Scalar): Target { return full ? { "10": n, "2": NaN, tail: undefined } : {}; }
function lockRoute(source: Target): Target { Object.freeze(source); return source; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function data(d: PropertyDescriptor | undefined, value: unknown, writable: boolean, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, undefined); same(d.set, undefined);
  assert.compareArray(Object.keys(d), ["value", "writable", "enumerable", "configurable"]);
}
for (const n of [-0, NaN, undefined, 7]) for (const full of [false, true]) {
  const source = make(full, n), result: Target = lockRoute(source), keys = full ? ["2", "10", "tail"] : [], values: Scalar[] = [NaN, n, undefined];
  same(result, source); assert.compareArray(state(result), [false, true, true]); assert.compareArray(names(result), keys);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i], value = values[i]; same(read(result, key), value); data(describe(result, key), value, false, true, false);
    assert.throws(TypeError, () => write(result, key, 11)); same(read(result, key), value); assert.compareArray(names(result), keys); data(describe(result, key), value, false, true, false);
    assert.throws(TypeError, () => remove(result, key)); same(read(result, key), value); assert.compareArray(names(result), keys); data(describe(result, key), value, false, true, false);
  }
  assert.throws(TypeError, () => write(result, "extra", n)); same(read(result, "extra"), undefined); same(describe(result, "extra"), undefined); assert.compareArray(names(result), keys);
  for (let i = 0; i < keys.length; i++) { same(read(result, keys[i]), values[i]); data(describe(result, keys[i]), values[i], false, true, false); }
}
