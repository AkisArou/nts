/*---
description: Explicit attribute-record control for A generic interface write to a getter-only property throws without changing backing data.
features: [ts-descriptor-route-accessors, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-interfaces, ts-optional-properties, ts-generics, ts-this-parameter, ts-function-types, ts-map-set, ts-spread, ts-tuples, ts-arrow-functions]
---*/
// A generic View route permits a write statically but the defined getter has no setter; node throws TypeError, leaves storage unchanged and never calls the getter for the write.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface View { raw: number; slot?: number; }
interface SlotFlags { get: (this: View) => number; set: ((this: View, value: number) => void) | undefined; enumerable: boolean; configurable: boolean; }
const calls: unknown[] = [], records = new Map<View, SlotFlags>();
function getter(this: View): number { calls.push(this); return this.raw; }
function make(initial: number): View { const source: View = { raw: initial }; records.set(source, { get: getter, set: undefined, enumerable: false, configurable: false }); return source; }
function flags(source: View): SlotFlags { const entry = records.get(source); if (entry === undefined) throw new Error("missing record"); return entry; }
function read<T extends View>(source: T): number | undefined { return flags(source).get.call(source); }
function write<T extends View>(source: T, value: number): void { const entry = flags(source); if (entry.set === undefined) throw new TypeError("no setter"); entry.set.call(source, value); }
function names(source: View): string[] { return [...Object.keys(source), "slot"]; }
function keys(source: View): string[] { return names(source).filter(key => key !== "slot" || flags(source).enumerable); }
function describe(source: View): PropertyDescriptor | undefined { return { ...flags(source) }; }
const inputs: [number, number][] = [[-0, 11], [NaN, -0], [7, NaN]];
for (const [initial, next] of inputs) {
  const source: View = make(initial); calls.length = 0;
  check(describe(source), undefined, undefined, false, false, getter, undefined); assert.compareArray(names(source), ["raw", "slot"]); assert.compareArray(keys(source), ["raw"]); assert.compareArray(calls, []);
  same(read(source), initial); assert.compareArray(calls, [source]); calls.length = 0;
  assert.throws(TypeError, () => write(source, next)); same(source.raw, initial); assert.compareArray(calls, []);
  check(describe(source), undefined, undefined, false, false, getter, undefined); same(read(source), initial); assert.compareArray(calls, [source]);
  assert.compareArray(names(source), ["raw", "slot"]); assert.compareArray(keys(source), ["raw"]);
}
