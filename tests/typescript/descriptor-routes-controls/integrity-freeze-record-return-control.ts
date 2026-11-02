/*---
description: "Explicit property-flag control: A frozen Record return exposes nonwritable nonconfigurable fields in numeric and string key order."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-record, ts-type-aliases, ts-strings, ts-null-undefined, ts-interfaces]
---*/
// A Record return carries an empty or mixed-key object after freeze; node retains every value and rejects existing writes, deletion and additions.
type Scalar = number | undefined;
interface Slot { value: Scalar; writable: boolean; enumerable: boolean; configurable: boolean; }
interface Target { fields: Record<string, Slot>; extensible: boolean; }
function names(value: Target): string[] { return Object.keys(value.fields); }
function describe(value: Target, key: string): PropertyDescriptor | undefined { const d = value.fields[key]; return d === undefined ? undefined : { value: d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable }; }
function read(value: Target, key: string): Scalar { return value.fields[key]?.value; }
function write(value: Target, key: string, next: Scalar): void { const d = value.fields[key]; if (d === undefined) { if (!value.extensible) throw new TypeError(); value.fields[key] = { value: next, writable: true, enumerable: true, configurable: true }; } else { if (!d.writable) throw new TypeError(); d.value = next; } }
function remove(value: Target, key: string): boolean { const d = value.fields[key]; if (d !== undefined && !d.configurable) throw new TypeError(); return delete value.fields[key]; }
function state(value: Target): boolean[] { const cells = Object.values(value.fields); return [value.extensible, !value.extensible && cells.every(d => !d.configurable), !value.extensible && cells.every(d => !d.configurable && !d.writable)]; }

function make(full: boolean, n: Scalar): Target {
  const values: Record<string, Scalar> = full ? { "10": n, "2": NaN, tail: undefined } : {}, fields: Record<string, Slot> = {};
  for (const key of Object.keys(values)) fields[key] = { value: values[key], writable: true, enumerable: true, configurable: true }; return { fields, extensible: true };
}
function lockRoute(source: Target): Target { source.extensible = false; for (const key of names(source)) { source.fields[key].configurable = false; source.fields[key].writable = false; } return source; }
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
