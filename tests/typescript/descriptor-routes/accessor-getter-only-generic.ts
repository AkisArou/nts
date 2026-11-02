/*---
description: A generic interface write to a getter-only property throws without changing backing data.
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
const calls: unknown[] = [];
function getter(this: View): number { calls.push(this); return this.raw; }
function make(initial: number): View { const source: View = { raw: initial }; Object.defineProperty(source, "slot", { get: getter }); return source; }
function read<T extends View>(source: T): number | undefined { return source.slot; }
function write<T extends View>(source: T, value: number): void { source.slot = value; }
function names(source: View): string[] { return Object.getOwnPropertyNames(source); }
function keys(source: View): string[] { return Object.keys(source); }
function describe(source: View): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(source, "slot"); }
const inputs: [number, number][] = [[-0, 11], [NaN, -0], [7, NaN]];
for (const [initial, next] of inputs) {
  const source: View = make(initial); calls.length = 0;
  check(describe(source), undefined, undefined, false, false, getter, undefined); assert.compareArray(names(source), ["raw", "slot"]); assert.compareArray(keys(source), ["raw"]); assert.compareArray(calls, []);
  same(read(source), initial); assert.compareArray(calls, [source]); calls.length = 0;
  assert.throws(TypeError, () => write(source, next)); same(source.raw, initial); assert.compareArray(calls, []);
  check(describe(source), undefined, undefined, false, false, getter, undefined); same(read(source), initial); assert.compareArray(calls, [source]);
  assert.compareArray(names(source), ["raw", "slot"]); assert.compareArray(keys(source), ["raw"]);
}
