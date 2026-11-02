/*---
description: "A sealed class instance in a typed field preserves writable data while rejecting deletion and extension."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-class, ts-class-fields, ts-declare-field, ts-interfaces, ts-optional-properties, ts-null-undefined]
---*/
// A class instance crosses seal through an interface field; node makes its own data nonconfigurable without making it nonwritable.
type Scalar = number | undefined;
class Target { declare value?: Scalar; declare extra?: Scalar; constructor(present: boolean, n: Scalar) { if (present) this.value = n; } }
function names(value: Target): string[] { return Object.getOwnPropertyNames(value); }
function describe(value: Target, key: keyof Target): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, key); }
function read(value: Target, key: keyof Target): Scalar { return value[key]; }
function write(value: Target, key: keyof Target, next: Scalar): void { value[key] = next; }
function remove(value: Target, key: keyof Target): boolean { return delete value[key]; }
function state(value: Target): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }
interface Owner { item: Target; }
function lockRoute(owner: Owner): Target { return Object.seal(owner.item); }
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
