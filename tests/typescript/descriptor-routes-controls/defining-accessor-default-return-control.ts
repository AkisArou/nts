/*---
description: Plain flag-record control for A typed object return receives an accessor whose omitted enumeration and configuration flags default to false.
features: [ts-descriptor-route-defining, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-optional-properties, ts-function-types, ts-null-undefined, ts-record, ts-spread, ts-this-parameter, ts-this]
---*/
// An interface return carries accessor data into defineProperty; node retains getter and setter identities, defaults flags to false and binds each callback to the object.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Access { read: (this: Target) => number; write: ((this: Target, value: number) => void) | undefined; enumerable: boolean; configurable: boolean; }
interface Target { raw: number; cells: Record<string, Access>; }
function makeTarget(value: number): Target { return { raw: value, cells: {} }; }
function install(target: Target, get: (this: Target) => number, set: ((this: Target, value: number) => void) | undefined): Target { target.cells.p = { read: get, write: set, enumerable: false, configurable: false }; return target; }
function describe(target: Target): PropertyDescriptor { const d = target.cells.p; return { get: d.read, set: d.write, enumerable: d.enumerable, configurable: d.configurable }; }
function read(target: Target): number { return target.cells.p.read.call(target); }
function write(target: Target, value: number): void { const set = target.cells.p.write; if (set === undefined) throw new TypeError("setter"); set.call(target, value); }
function names(target: Target): string[] { return ["raw", ...Object.keys(target.cells)]; }
function keys(target: Target): string[] { return ["raw", ...Object.keys(target.cells).filter(key => target.cells[key].enumerable)]; }
const reads: number[] = [], writes: number[] = [];
function getter(this: Target): number { reads.push(this.raw); return this.raw; }
function setter(this: Target, value: number): void { writes.push(value); this.raw = value; }
for (const input of [-0, NaN, 17]) for (const writable of [false, true]) {
  reads.length = 0; writes.length = 0; const target: Target = makeTarget(input), set = writable ? setter : undefined;
  same(install(target, getter, set), target); check(describe(target), undefined, undefined, false, false, getter, set);
  assert.compareArray(names(target), ["raw", "p"]); assert.compareArray(keys(target), ["raw"]); same(read(target), input);
  if (writable) write(target, 23); else { assert.throws(TypeError, () => write(target, 23)); same(target.raw, input); }
  same(target.raw, writable ? 23 : input); same(read(target), writable ? 23 : input);
  check(describe(target), undefined, undefined, false, false, getter, set); assert.compareArray(reads, [input, writable ? 23 : input]); assert.compareArray(writes, writable ? [23] : []);
}
