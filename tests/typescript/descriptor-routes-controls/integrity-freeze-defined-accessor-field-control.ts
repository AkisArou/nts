/*---
description: "Explicit property-flag control: Freezing a defined accessor through an interface field preserves its setter and receiver while freezing data flags."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-function-types, ts-this-parameter, ts-strings, ts-null-undefined, ts-unions, ts-record]
---*/
// An interface field carries a defined accessor and data child to freeze; node keeps the accessor callable on its receiver and only makes data nonwritable.
interface Cell { value: number; }
interface Target { fields: { state: { value: Cell; writable: boolean; enumerable: boolean; configurable: boolean }; value: { get: (this: Target) => number; set: (this: Target, n: number) => void; enumerable: boolean; configurable: boolean } }; extensible: boolean; }
interface Owner { item: Target; }
function cell(value: Target): Cell { return value.fields.state.value; }
function make(n: number, enumerable: boolean): Target { return { fields: { state: { value: { value: n }, writable: true, enumerable: true, configurable: true }, value: { get: receiverGet, set: receiverSet, enumerable, configurable: true } }, extensible: true }; }
function names(value: Target): string[] { return Object.keys(value.fields); }
function listed(value: Target): string[] { return names(value).filter(key => key === "state" ? value.fields.state.enumerable : value.fields.value.enumerable); }
function describe(value: Target, key: "state" | "value"): PropertyDescriptor | undefined { if (key === "state") { const d = value.fields.state; return { value: d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable }; } const d = value.fields.value; return { get: d.get, set: d.set, enumerable: d.enumerable, configurable: d.configurable }; }
function read(value: Target): number | undefined { return value.fields.value.get.call(value); }
function write(value: Target, next: number): void { value.fields.value.set.call(value, next); }
function replace(value: Target, next: Cell): void { if (!value.fields.state.writable) throw new TypeError(); value.fields.state.value = next; }
function state(value: Target): boolean[] { const fields = value.fields, sealed = !value.extensible && !fields.state.configurable && !fields.value.configurable; return [value.extensible, sealed, sealed && !fields.state.writable]; }
function lockRoute(owner: Owner): Target { const value = owner.item; value.extensible = false; value.fields.state.configurable = false; value.fields.state.writable = false; value.fields.value.configurable = false; return value; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function data(d: PropertyDescriptor | undefined, value: unknown, writable: boolean, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, undefined); same(d.set, undefined);
  assert.compareArray(Object.keys(d), ["value", "writable", "enumerable", "configurable"]);
}
const events: unknown[] = [];
function receiverGet(this: Target): number { events.push("get", this); return cell(this).value; }
function receiverSet(this: Target, n: number): void { events.push("set", this); cell(this).value = n; }
function accessor(d: PropertyDescriptor | undefined, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, undefined); same(d.writable, undefined); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, receiverGet); same(d.set, receiverSet); assert.compareArray(Object.keys(d), ["get", "set", "enumerable", "configurable"]);
}
for (const n of [-0, NaN, 7]) for (const enumerable of [false, true]) {
  events.length = 0; const owner: Owner = { item: make(n, enumerable) }, source = owner.item, child = cell(source);
  data(describe(source, "state"), child, true, true, true); accessor(describe(source, "value"), enumerable, true); same(lockRoute(owner), source);
  assert.compareArray(state(source), [false, true, true]); assert.compareArray(names(source), ["state", "value"]); assert.compareArray(listed(source), enumerable ? ["state", "value"] : ["state"]);
  data(describe(source, "state"), child, false, true, false); accessor(describe(source, "value"), enumerable, false); assert.compareArray(events, []); same(child.value, n);
  write(source, 23); same(read(source), 23); same(cell(source), child); same(child.value, 23); assert.compareArray(events, ["set", source, "get", source]);
  assert.throws(TypeError, () => replace(source, { value: 99 })); same(cell(source), child); same(child.value, 23); same(read(source), 23); data(describe(source, "state"), child, false, true, false); accessor(describe(source, "value"), enumerable, false); assert.compareArray(events, ["set", source, "get", source, "get", source]);
}
