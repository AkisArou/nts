/*---
description: Explicit attribute-record control for A typed return carries a configurable accessor replaced by an ordinary data property.
features: [ts-descriptor-route-accessors, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-interfaces, ts-optional-properties, ts-this-parameter, ts-function-types, ts-map-set, ts-spread, ts-tuples, ts-arrow-functions]
---*/
// A returned View has an accessor redefined as writable data; node retains enumerability and key position, removes callbacks and keeps backing storage independent.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface View { raw: number; slot?: number; tail: number; }
interface SlotFlags { value?: number; writable?: boolean; get?: (this: View) => number; set?: (this: View, value: number) => void; enumerable: boolean; configurable: boolean; }
const calls: unknown[] = [], records = new Map<View, SlotFlags>();
function getter(this: View): number { calls.push("get", this); return this.raw; }
function setter(this: View, value: number): void { calls.push("set", this, value); this.raw = value; }
function make(initial: number, show: boolean): View { const source: View = { raw: initial, tail: 9 }; records.set(source, { get: getter, set: setter, enumerable: show, configurable: true }); return source; }
function returned(source: View): View { return source; }
function flags(source: View): SlotFlags { const entry = records.get(returned(source)); if (entry === undefined) throw new Error("missing record"); return entry; }
function replace(source: View, value: number): void { const entry = flags(source); if (!entry.configurable) throw new TypeError("not configurable"); records.set(returned(source), { value, writable: true, enumerable: entry.enumerable, configurable: entry.configurable }); }
function read(source: View): number | undefined { const entry = flags(source); return entry.get === undefined ? entry.value : entry.get.call(returned(source)); }
function write(source: View, value: number): void { const entry = flags(source); if (entry.set !== undefined) entry.set.call(returned(source), value); else { if (!entry.writable) throw new TypeError("not writable"); entry.value = value; } }
function names(source: View): string[] { return [...Object.keys(returned(source)), "slot"]; }
function keys(source: View): string[] { return names(source).filter(key => key !== "slot" || flags(source).enumerable); }
function describe(source: View): PropertyDescriptor | undefined { return { ...flags(source) }; }
const inputs: [number, number][] = [[-0, 11], [NaN, -0], [7, NaN]];
for (const [initial, next] of inputs) for (const show of [false, true]) {
  const source: View = make(initial, show); calls.length = 0;
  check(describe(source), undefined, undefined, show, true, getter, setter); same(read(source), initial); assert.compareArray(calls, ["get", source]); calls.length = 0;
  replace(source, next); same(source.raw, initial); check(describe(source), next, true, show, true); same(read(source), next); assert.compareArray(calls, []);
  assert.compareArray(names(source), ["raw", "tail", "slot"]); assert.compareArray(keys(source), show ? ["raw", "tail", "slot"] : ["raw", "tail"]);
  write(source, 53); same(read(source), 53); same(source.raw, initial); same(source.tail, 9); assert.compareArray(calls, []); check(describe(source), 53, true, show, true);
}
