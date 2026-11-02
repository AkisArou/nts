/*---
description: A class field route distinguishes prototype methods, hidden instance fields and explicitly defined instance data.
features: [ts-descriptor-route-enumerability, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-declare-field, ts-optional-properties, ts-interfaces, ts-record, ts-map-set, ts-spread, ts-arrow-functions]
---*/
// A holder carries a class instance whose ordinary field is hidden and another field is defined; node lists only enumerable own data while method and constructor descriptors remain nonenumerable.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
class EnumItem { shown: number; hidden: number; declare added?: number; constructor(value: number) { this.shown = value; this.hidden = value; } method(): number { return this.shown; } }
interface Holder { item: EnumItem; }
function make(value: number, show: boolean): EnumItem { const source = new EnumItem(value); Object.defineProperty(source, "hidden", { enumerable: false }); Object.defineProperty(source, "added", { value: 9, enumerable: show }); return source; }
function keys(holder: Holder): string[] { return Object.keys(holder.item); }
function names(holder: Holder): string[] { return Object.getOwnPropertyNames(holder.item); }
function values(holder: Holder): unknown[] { return Object.values(holder.item); }
function read(holder: Holder): unknown[] { return [holder.item.shown, holder.item.hidden, holder.item.added]; }
function describe(holder: Holder, key: string): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(holder.item, key); }
function prototypeNames(): string[] { return Object.getOwnPropertyNames(EnumItem.prototype); }
function prototypeKeys(): string[] { return Object.keys(EnumItem.prototype); }
function methodDescriptor(): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(EnumItem.prototype, "method"); }
for (const initial of [-0, NaN, 7]) for (const show of [false, true]) {
  const holder: Holder = { item: make(initial, show) };
  assert.compareArray(keys(holder), show ? ["shown", "added"] : ["shown"]); assert.compareArray(names(holder), ["shown", "hidden", "added"]); assert.compareArray(values(holder), show ? [initial, 9] : [initial]); assert.compareArray(read(holder), [initial, initial, 9]);
  check(describe(holder, "shown"), initial, true, true, true); check(describe(holder, "hidden"), initial, true, false, true); check(describe(holder, "added"), 9, false, show, false);
  same(describe(holder, "method"), undefined); same("method" in holder.item, true); same(holder.item.method(), initial);
  assert.compareArray(prototypeNames(), ["constructor", "method"]); assert.compareArray(prototypeKeys(), []); check(methodDescriptor(), EnumItem.prototype.method, true, false, true);
}
