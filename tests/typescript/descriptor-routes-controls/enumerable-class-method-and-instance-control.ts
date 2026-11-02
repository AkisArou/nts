/*---
description: Explicit attribute-record control for A class field route distinguishes prototype methods, hidden instance fields and explicitly defined instance data.
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
interface Cell { value: unknown; writable: boolean; enumerable: boolean; configurable: boolean; }
const records = new Map<EnumItem, Record<string, Cell>>();
function make(value: number, show: boolean): EnumItem { const source = new EnumItem(value); records.set(source, { shown: { value, writable: true, enumerable: true, configurable: true }, hidden: { value, writable: true, enumerable: false, configurable: true }, added: { value: 9, writable: false, enumerable: show, configurable: false } }); return source; }
function table(holder: Holder): Record<string, Cell> { const result = records.get(holder.item); if (result === undefined) throw new Error("record"); return result; }
function keys(holder: Holder): string[] { const entries = table(holder); return Object.keys(entries).filter(key => entries[key].enumerable); }
function names(holder: Holder): string[] { return Object.keys(table(holder)); }
function values(holder: Holder): unknown[] { const entries = table(holder); return keys(holder).map(key => entries[key].value); }
function read(holder: Holder): unknown[] { const entries = table(holder); return [entries.shown.value, entries.hidden.value, entries.added.value]; }
function describe(holder: Holder, key: string): PropertyDescriptor | undefined { const entry = table(holder)[key]; return entry === undefined ? undefined : { ...entry }; }
const prototypeFlags: Record<string, Cell> = { constructor: { value: EnumItem, writable: true, enumerable: false, configurable: true }, method: { value: EnumItem.prototype.method, writable: true, enumerable: false, configurable: true } };
function prototypeNames(): string[] { return Object.keys(prototypeFlags); }
function prototypeKeys(): string[] { return prototypeNames().filter(key => prototypeFlags[key].enumerable); }
function methodDescriptor(): PropertyDescriptor | undefined { return { ...prototypeFlags.method }; }
for (const initial of [-0, NaN, 7]) for (const show of [false, true]) {
  const holder: Holder = { item: make(initial, show) };
  assert.compareArray(keys(holder), show ? ["shown", "added"] : ["shown"]); assert.compareArray(names(holder), ["shown", "hidden", "added"]); assert.compareArray(values(holder), show ? [initial, 9] : [initial]); assert.compareArray(read(holder), [initial, initial, 9]);
  check(describe(holder, "shown"), initial, true, true, true); check(describe(holder, "hidden"), initial, true, false, true); check(describe(holder, "added"), 9, false, show, false);
  same(describe(holder, "method"), undefined); same("method" in holder.item, true); same(holder.item.method(), initial);
  assert.compareArray(prototypeNames(), ["constructor", "method"]); assert.compareArray(prototypeKeys(), []); check(methodDescriptor(), EnumItem.prototype.method, true, false, true);
}
