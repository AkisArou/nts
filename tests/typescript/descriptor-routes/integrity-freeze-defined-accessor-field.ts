/*---
description: "Freezing a defined accessor through an interface field preserves its setter and receiver while freezing data flags."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-function-types, ts-this-parameter, ts-strings, ts-null-undefined, ts-unions]
---*/
// An interface field carries a defined accessor and data child to freeze; node keeps the accessor callable on its receiver and only makes data nonwritable.
interface Cell { value: number; }
interface Target { state: Cell; value?: number; }
interface Owner { item: Target; }
function cell(value: Target): Cell { return value.state; }
function make(n: number, enumerable: boolean): Target { const value: Target = { state: { value: n } }; Object.defineProperty(value, "value", { get: receiverGet, set: receiverSet, enumerable, configurable: true }); return value; }
function names(value: Target): string[] { return Object.getOwnPropertyNames(value); }
function listed(value: Target): string[] { return Object.keys(value); }
function describe(value: Target, key: "state" | "value"): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, key); }
function read(value: Target): number | undefined { return value.value; }
function write(value: Target, next: number): void { value.value = next; }
function replace(value: Target, next: Cell): void { value.state = next; }
function state(value: Target): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }
function lockRoute(owner: Owner): Target { Object.freeze(owner.item); return owner.item; }
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
