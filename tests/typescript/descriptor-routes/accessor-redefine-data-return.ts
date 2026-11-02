/*---
description: A typed return carries a configurable accessor replaced by an ordinary data property.
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
const calls: unknown[] = [];
function getter(this: View): number { calls.push("get", this); return this.raw; }
function setter(this: View, value: number): void { calls.push("set", this, value); this.raw = value; }
function make(initial: number, show: boolean): View { const source: View = { raw: initial, tail: 9 }; Object.defineProperty(source, "slot", { get: getter, set: setter, enumerable: show, configurable: true }); return source; }
function returned(source: View): View { return source; }
function replace(source: View, value: number): void { Object.defineProperty(returned(source), "slot", { value, writable: true }); }
function read(source: View): number | undefined { return returned(source).slot; }
function write(source: View, value: number): void { returned(source).slot = value; }
function names(source: View): string[] { return Object.getOwnPropertyNames(returned(source)); }
function keys(source: View): string[] { return Object.keys(returned(source)); }
function describe(source: View): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(returned(source), "slot"); }
const inputs: [number, number][] = [[-0, 11], [NaN, -0], [7, NaN]];
for (const [initial, next] of inputs) for (const show of [false, true]) {
  const source: View = make(initial, show); calls.length = 0;
  check(describe(source), undefined, undefined, show, true, getter, setter); same(read(source), initial); assert.compareArray(calls, ["get", source]); calls.length = 0;
  replace(source, next); same(source.raw, initial); check(describe(source), next, true, show, true); same(read(source), next); assert.compareArray(calls, []);
  assert.compareArray(names(source), ["raw", "tail", "slot"]); assert.compareArray(keys(source), show ? ["raw", "tail", "slot"] : ["raw", "tail"]);
  write(source, 53); same(read(source), 53); same(source.raw, initial); same(source.tail, 9); assert.compareArray(calls, []); check(describe(source), 53, true, show, true);
}
