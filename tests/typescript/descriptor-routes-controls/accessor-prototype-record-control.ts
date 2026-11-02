/*---
description: Explicit attribute-record control for A Record receiver uses a defined accessor on a custom prototype without changing prototype storage.
features: [ts-descriptor-route-accessors, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-record, ts-interfaces, ts-this-parameter, ts-function-types, ts-map-set, ts-spread, ts-tuples, ts-arrow-functions]
---*/
// Number Records inherit a defined accessor from a plain prototype; node reads and writes the receiver backing field and never creates an own accessor slot.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
type View = Record<string, number>;
interface SlotFlags { get: (this: View) => number; set: (this: View, value: number) => void; enumerable: boolean; configurable: boolean; }
const calls: unknown[] = [], records = new Map<View, SlotFlags>();
function getter(this: View): number { calls.push("get", this); return this.raw; }
function setter(this: View, value: number): void { calls.push("set", this, value); this.raw = value; }
function make(initial: number): [View, View] { const parent: View = { raw: -100 }; records.set(parent, { get: getter, set: setter, enumerable: true, configurable: true }); const source: View = Object.create(parent); source.raw = initial; source.id = 17; return [source, parent]; }
function flags(source: View): SlotFlags { const entry = records.get(source) ?? records.get(Object.getPrototypeOf(source)); if (entry === undefined) throw new Error("missing record"); return entry; }
function read(source: View): number { return flags(source).get.call(source); }
function write(source: View, value: number): void { flags(source).set.call(source, value); }
function names(source: View): string[] { return [...Object.keys(source), ...(records.has(source) ? ["slot"] : [])]; }
function keys(source: View): string[] { return names(source).filter(key => key !== "slot" || flags(source).enumerable); }
function present(source: View): boolean { return records.has(source) || records.has(Object.getPrototypeOf(source)); }
function describe(source: View): PropertyDescriptor | undefined { const entry = records.get(source); return entry === undefined ? undefined : { ...entry }; }
for (const initial of [-0, NaN, 7]) {
  const [source, parent] = make(initial); calls.length = 0;
  check(describe(parent), undefined, undefined, true, true, getter, setter); same(describe(source), undefined); same(Object.getPrototypeOf(source), parent); same(present(source), true);
  assert.compareArray(names(parent), ["raw", "slot"]); assert.compareArray(keys(parent), ["raw", "slot"]); assert.compareArray(names(source), ["raw", "id"]); assert.compareArray(keys(source), ["raw", "id"]); assert.compareArray(calls, []);
  same(read(source), initial); write(source, 29); same(source.raw, 29); same(parent.raw, -100); same(source.id, 17); same(read(source), 29);
  assert.compareArray(calls, ["get", source, "set", source, 29, "get", source]); same(describe(source), undefined); assert.compareArray(names(source), ["raw", "id"]);
  check(describe(parent), undefined, undefined, true, true, getter, setter);
}
