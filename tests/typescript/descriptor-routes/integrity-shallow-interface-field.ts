/*---
description: "A frozen parent reached through an interface field leaves its child extensible writable and deletable."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-optional-properties, ts-null-undefined]
---*/
// An interface field carries a parent with a typed child to freeze; node freezes the parent descriptor while child writes, additions and deletion still succeed.
type Scalar = number | undefined;
interface Target { value?: Scalar; extra?: Scalar; }
function names(value: Target): string[] { return Object.getOwnPropertyNames(value); }
function describe(value: Target, key: keyof Target): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, key); }
function read(value: Target, key: keyof Target): Scalar { return value[key]; }
function write(value: Target, key: keyof Target, next: Scalar): void { value[key] = next; }
function remove(value: Target, key: keyof Target): boolean { return delete value[key]; }
function state(value: Target): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }
function make(present: boolean, n: Scalar): Target { return present ? { value: n } : {}; }

interface Envelope { item: Target; }
interface Owner { envelope: Envelope; }
function wrap(item: Target): Envelope { return { item }; }
function lockRoute(owner: Owner): Envelope { Object.freeze(owner.envelope); return owner.envelope; }
function childOf(value: Envelope): Target { return value.item; }
function replace(value: Envelope, next: Target): void { value.item = next; }
function parentNames(value: Envelope): string[] { return Object.getOwnPropertyNames(value); }
function parentDescriptor(value: Envelope): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, "item"); }
function parentState(value: Envelope): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function data(d: PropertyDescriptor | undefined, value: unknown, writable: boolean, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, undefined); same(d.set, undefined);
  assert.compareArray(Object.keys(d), ["value", "writable", "enumerable", "configurable"]);
}
for (const n of [-0, NaN, undefined, 7]) for (const present of [false, true]) {
  const child: Target = make(present, n), owner: Owner = { envelope: wrap(child) }, source = owner.envelope, initial = present ? ["value"] : [];
  same(lockRoute(owner), source); same(childOf(source), child); assert.compareArray(parentState(source), [false, true, true]); assert.compareArray(parentNames(source), ["item"]); data(parentDescriptor(source), child, false, true, false);
  assert.compareArray(state(child), [true, false, false]); assert.compareArray(names(child), initial); if (present) data(describe(child, "value"), n, true, true, true);
  assert.throws(TypeError, () => replace(source, make(false, 11))); same(childOf(source), child); assert.compareArray(names(child), initial); same(read(child, "value"), present ? n : undefined); data(parentDescriptor(source), child, false, true, false);
  write(child, "value", 23); write(child, "extra", 11); same(read(childOf(source), "value"), 23); same(read(childOf(source), "extra"), 11); assert.compareArray(names(child), ["value", "extra"]);
  data(describe(child, "value"), 23, true, true, true); data(describe(child, "extra"), 11, true, true, true); assert.compareArray(state(child), [true, false, false]);
  same(remove(child, "value"), true); same(read(child, "value"), undefined); same(describe(child, "value"), undefined); assert.compareArray(names(child), ["extra"]); same(childOf(source), child);
  assert.compareArray(parentState(source), [false, true, true]); data(parentDescriptor(source), child, false, true, false);
}
