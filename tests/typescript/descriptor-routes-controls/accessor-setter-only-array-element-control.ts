/*---
description: Explicit attribute-record control for An interface array element exposes a setter-only property and preserves assignment expression values.
features: [ts-descriptor-route-accessors, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-interfaces, ts-optional-properties, ts-this-parameter, ts-function-types, ts-map-set, ts-spread, ts-arrow-functions]
---*/
// A View array carries setter-only defined accessors; node reads undefined, returns the assigned input and calls the setter on the element while it doubles backing data.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface View { raw: number; slot?: number; }
interface SlotFlags { get: ((this: View) => number) | undefined; set: (this: View, value: number) => void; enumerable: boolean; configurable: boolean; }
const calls: unknown[] = [], records = new Map<View, SlotFlags>();
function setter(this: View, value: number): void { calls.push(this, value); this.raw = value * 2; }
function make(initial: number): View { const source: View = { raw: initial }; records.set(source, { get: undefined, set: setter, enumerable: true, configurable: false }); return source; }
function flags(source: View): SlotFlags { const entry = records.get(source); if (entry === undefined) throw new Error("missing record"); return entry; }
function read(source: View): number | undefined { const entry = flags(source); return entry.get === undefined ? undefined : entry.get.call(source); }
function write(source: View, value: number): number { flags(source).set.call(source, value); return value; }
function names(source: View): string[] { return [...Object.keys(source), "slot"]; }
function keys(source: View): string[] { return names(source).filter(key => key !== "slot" || flags(source).enumerable); }
function describe(source: View): PropertyDescriptor | undefined { return { ...flags(source) }; }
const inputs: number[][] = [[], [-0], [NaN, 7], [1, -3, 9]];
for (const input of inputs) {
  const sources: View[] = input.map(make);
  for (let i = 0; i < sources.length; i++) {
    const source: View = sources[i]; calls.length = 0; check(describe(source), undefined, undefined, true, false, undefined, setter);
    assert.compareArray(names(source), ["raw", "slot"]); assert.compareArray(keys(source), ["raw", "slot"]); same(read(source), undefined); same(source.raw, input[i]); assert.compareArray(calls, []);
    same(write(source, input[i]), input[i]); same(source.raw, input[i] * 2); same(read(source), undefined); assert.compareArray(calls, [source, input[i]]);
    check(describe(source), undefined, undefined, true, false, undefined, setter);
  }
}
