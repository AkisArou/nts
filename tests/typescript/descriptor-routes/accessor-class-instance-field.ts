/*---
description: A class-typed holder field routes defined instance accessors to the matching receiver.
features: [ts-descriptor-route-accessors, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-declare-field, ts-interfaces, ts-optional-properties, ts-this-parameter, ts-function-types, ts-map-set, ts-spread, ts-arrow-functions]
---*/
// Holder fields carry class instances with defined own accessors; node binds each callback to its instance and a setter leaves the sibling unchanged.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
class AccessItem { raw: number; id: number; declare slot?: number; constructor(raw: number, id: number) { this.raw = raw; this.id = id; } }
interface Holder { item: AccessItem; }
const calls: unknown[] = [];
function getter(this: AccessItem): number { calls.push("get", this); return this.raw; }
function setter(this: AccessItem, value: number): void { calls.push("set", this, value); this.raw = value; }
function make(initial: number, id: number): Holder { const item = new AccessItem(initial, id); Object.defineProperty(item, "slot", { get: getter, set: setter, enumerable: false, configurable: true }); return { item }; }
function read(holder: Holder): number | undefined { return holder.item.slot; }
function write(holder: Holder, value: number): void { holder.item.slot = value; }
function names(holder: Holder): string[] { return Object.getOwnPropertyNames(holder.item); }
function keys(holder: Holder): string[] { return Object.keys(holder.item); }
function describe(holder: Holder): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(holder.item, "slot"); }
for (const initial of [-0, NaN, 7]) {
  const first: Holder = make(initial, 1), second: Holder = make(41, 2); calls.length = 0;
  for (const holder of [first, second]) { check(describe(holder), undefined, undefined, false, true, getter, setter); assert.compareArray(names(holder), ["raw", "id", "slot"]); assert.compareArray(keys(holder), ["raw", "id"]); }
  assert.compareArray(calls, []); same(read(first), initial); same(read(second), 41); assert.compareArray(calls, ["get", first.item, "get", second.item]); calls.length = 0;
  write(first, 23); same(first.item.raw, 23); same(second.item.raw, 41); same(first.item.id, 1); same(second.item.id, 2);
  same(read(first), 23); same(read(second), 41); assert.compareArray(calls, ["set", first.item, 23, "get", first.item, "get", second.item]);
  for (const holder of [first, second]) check(describe(holder), undefined, undefined, false, true, getter, setter);
}
