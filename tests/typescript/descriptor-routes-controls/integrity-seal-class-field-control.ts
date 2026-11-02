/*---
description: "Explicit property-flag control: A sealed class instance in a typed field preserves writable data while rejecting deletion and extension."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-class, ts-class-fields, ts-declare-field, ts-interfaces, ts-optional-properties, ts-null-undefined, ts-record]
---*/
// A class instance crosses seal through an interface field; node makes its own data nonconfigurable without making it nonwritable.
type Scalar = number | undefined;
interface Slot { value: Scalar; writable: boolean; enumerable: boolean; configurable: boolean; }
class Target { fields: Record<string, Slot>; extensible: boolean = true; constructor(present: boolean, n: Scalar) { this.fields = present ? { value: { value: n, writable: true, enumerable: true, configurable: true } } : {}; } }
function names(value: Target): string[] { return Object.keys(value.fields); }
function describe(value: Target, key: "value" | "extra"): PropertyDescriptor | undefined { const d = value.fields[key]; return d === undefined ? undefined : { value: d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable }; }
function read(value: Target, key: "value" | "extra"): Scalar { return value.fields[key]?.value; }
function write(value: Target, key: "value" | "extra", next: Scalar): void { const d = value.fields[key]; if (d === undefined) { if (!value.extensible) throw new TypeError(); value.fields[key] = { value: next, writable: true, enumerable: true, configurable: true }; } else { if (!d.writable) throw new TypeError(); d.value = next; } }
function remove(value: Target, key: "value" | "extra"): boolean { const d = value.fields[key]; if (d !== undefined && !d.configurable) throw new TypeError(); return delete value.fields[key]; }
function state(value: Target): boolean[] { const cells = Object.values(value.fields); return [value.extensible, !value.extensible && cells.every(d => !d.configurable), !value.extensible && cells.every(d => !d.configurable && !d.writable)]; }
interface Owner { item: Target; }
function lockRoute(owner: Owner): Target { const value = owner.item; value.extensible = false; for (const key of names(value)) value.fields[key].configurable = false; return value; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function data(d: PropertyDescriptor | undefined, value: unknown, writable: boolean, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, undefined); same(d.set, undefined);
  assert.compareArray(Object.keys(d), ["value", "writable", "enumerable", "configurable"]);
}
for (const n of [-0, NaN, undefined, 7]) for (const present of [false, true]) {
  const owner: Owner = { item: new Target(present, n) }, source = owner.item, expected = present ? ["value"] : [];
  assert.compareArray(state(source), [true, false, false]); same(lockRoute(owner), source); assert.compareArray(state(source), [false, true, !present]);
  assert.compareArray(names(source), expected); if (present) data(describe(source, "value"), n, true, true, false); else same(describe(source, "value"), undefined);
  assert.throws(TypeError, () => write(source, "extra", 11)); same(read(source, "extra"), undefined); same(read(source, "value"), present ? n : undefined); assert.compareArray(names(source), expected);
  if (present) {
    write(source, "value", 23); same(read(source, "value"), 23); data(describe(source, "value"), 23, true, true, false);
    assert.throws(TypeError, () => remove(source, "value")); same(read(source, "value"), 23); assert.compareArray(names(source), expected); data(describe(source, "value"), 23, true, true, false);
  } else { same(remove(source, "value"), true); same(describe(source, "value"), undefined); assert.compareArray(names(source), []); }
}
