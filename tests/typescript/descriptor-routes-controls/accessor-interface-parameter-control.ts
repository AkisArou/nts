/*---
description: Explicit attribute-record control for An interface parameter preserves the receiver of a defined getter and setter.
features: [ts-descriptor-route-accessors, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-interfaces, ts-optional-properties, ts-this-parameter, ts-function-types, ts-map-set, ts-spread, ts-tuples]
---*/
// An interface parameter carries an own accessor with variable enumerability; node passes the actual object as this and writes only its backing data.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface View { raw: number; id: number; slot?: number; }
interface SlotFlags { get: (this: View) => number; set: (this: View, value: number) => void; enumerable: boolean; configurable: boolean; }
const calls: unknown[] = [], records = new Map<View, SlotFlags>();
function getter(this: View): number { calls.push("get", this); return this.raw; }
function setter(this: View, value: number): void { calls.push("set", this, value); this.raw = value; }
function make(initial: number, show: boolean): View { const source: View = { raw: initial, id: 17 }; records.set(source, { get: getter, set: setter, enumerable: show, configurable: true }); return source; }
function flags(source: View): SlotFlags { const result = records.get(source); if (result === undefined) throw new Error("missing record"); return result; }
function read(source: View): number | undefined { return flags(source).get.call(source); }
function write(source: View, value: number): number { flags(source).set.call(source, value); return value; }
function names(source: View): string[] { return [...Object.keys(source), "slot"]; }
function keys(source: View): string[] { return flags(source).enumerable ? names(source) : Object.keys(source); }
function describe(source: View): PropertyDescriptor | undefined { return { ...flags(source) }; }
const inputs: [number, number][] = [[-0, 11], [NaN, -0], [7, NaN]];
for (const [initial, next] of inputs) for (const show of [false, true]) {
  const source: View = make(initial, show); calls.length = 0;
  check(describe(source), undefined, undefined, show, true, getter, setter); assert.compareArray(calls, []);
  assert.compareArray(names(source), ["raw", "id", "slot"]); assert.compareArray(keys(source), show ? ["raw", "id", "slot"] : ["raw", "id"]);
  same(read(source), initial); assert.compareArray(calls, ["get", source]); calls.length = 0;
  same(write(source, next), next); same(source.raw, next); same(source.id, 17); same(read(source), next); assert.compareArray(calls, ["set", source, next, "get", source]);
  check(describe(source), undefined, undefined, show, true, getter, setter);
}
