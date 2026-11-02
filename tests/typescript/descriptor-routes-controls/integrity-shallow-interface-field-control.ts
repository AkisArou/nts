/*---
description: "Explicit property-flag control: A frozen parent reached through an interface field leaves its child extensible writable and deletable."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-optional-properties, ts-null-undefined, ts-record]
---*/
// An interface field carries a parent with a typed child to freeze; node freezes the parent descriptor while child writes, additions and deletion still succeed.
type Scalar = number | undefined;
interface Slot { value: Scalar; writable: boolean; enumerable: boolean; configurable: boolean; }
interface Target { fields: Record<string, Slot>; extensible: boolean; }
function names(value: Target): string[] { return Object.keys(value.fields); }
function describe(value: Target, key: "value" | "extra"): PropertyDescriptor | undefined { const d = value.fields[key]; return d === undefined ? undefined : { value: d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable }; }
function read(value: Target, key: "value" | "extra"): Scalar { return value.fields[key]?.value; }
function write(value: Target, key: "value" | "extra", next: Scalar): void { const d = value.fields[key]; if (d === undefined) { if (!value.extensible) throw new TypeError(); value.fields[key] = { value: next, writable: true, enumerable: true, configurable: true }; } else { if (!d.writable) throw new TypeError(); d.value = next; } }
function remove(value: Target, key: "value" | "extra"): boolean { const d = value.fields[key]; if (d !== undefined && !d.configurable) throw new TypeError(); return delete value.fields[key]; }
function state(value: Target): boolean[] { const cells = Object.values(value.fields); return [value.extensible, !value.extensible && cells.every(d => !d.configurable), !value.extensible && cells.every(d => !d.configurable && !d.writable)]; }
function make(present: boolean, n: Scalar): Target { return { fields: present ? { value: { value: n, writable: true, enumerable: true, configurable: true } } : {}, extensible: true }; }

interface Envelope { item: { value: Target; writable: boolean; enumerable: boolean; configurable: boolean }; extensible: boolean; }
interface Owner { envelope: Envelope; }
function wrap(value: Target): Envelope { return { item: { value, writable: true, enumerable: true, configurable: true }, extensible: true }; }
function lockRoute(owner: Owner): Envelope { const value = owner.envelope; value.extensible = false; value.item.writable = false; value.item.configurable = false; return value; }
function childOf(value: Envelope): Target { return value.item.value; }
function replace(value: Envelope, next: Target): void { if (!value.item.writable) throw new TypeError(); value.item.value = next; }
function parentNames(value: Envelope): string[] { return ["item"]; }
function parentDescriptor(value: Envelope): PropertyDescriptor | undefined { const d = value.item; return { value: d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable }; }
function parentState(value: Envelope): boolean[] { return [value.extensible, !value.extensible && !value.item.configurable, !value.extensible && !value.item.configurable && !value.item.writable]; }
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
