/*---
description: Plain flag-record control for A class field preserves nonconfigurable accessor identities while rejecting replacement callbacks and data conversion.
features: [ts-descriptor-route-defining, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-class, ts-class-fields, ts-declare-field, ts-function-types, ts-this-parameter, ts-this, ts-interfaces, ts-record, ts-spread, ts-optional-properties]
---*/
// A holder field carries a class instance into accessor redefinition; node permits identical callbacks, rejects different identities and keeps the original getter and setter.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Access { read: (this: Target) => number; write: (this: Target, value: number) => void; enumerable: boolean; configurable: boolean; }
class Target { raw: number; cells: Record<string, Access> = {}; constructor(value: number) { this.raw = value; } }
class Holder { target: Target; constructor(value: number) { this.target = new Target(value); } }

interface Change { value?: number; get?: (this: Target) => number; set?: (this: Target, value: number) => void; }

function install(holder: Holder): void { holder.target.cells.p = { read: getter, write: setter, enumerable: true, configurable: false }; }
function redefine(holder: Holder, change: Change): Target { const d = holder.target.cells.p; if (!d.configurable && ("value" in change || "get" in change && change.get !== d.read || "set" in change && change.set !== d.write)) throw new TypeError("redefine"); return holder.target; }
function describe(holder: Holder): PropertyDescriptor { const d = holder.target.cells.p; return { get: d.read, set: d.write, enumerable: d.enumerable, configurable: d.configurable }; }
function read(holder: Holder): number { return holder.target.cells.p.read.call(holder.target); }
function write(holder: Holder, value: number): void { holder.target.cells.p.write.call(holder.target, value); }
function names(holder: Holder): string[] { return ["raw", ...Object.keys(holder.target.cells)]; }
function getter(this: Target): number { return this.raw; }
function setter(this: Target, value: number): void { this.raw = value; }
function otherGetter(this: Target): number { return this.raw; }
function otherSetter(this: Target, value: number): void { this.raw = value; }
for (const input of [-0, NaN, 17]) {
  const holder: Holder = new Holder(input); install(holder); check(describe(holder), undefined, undefined, true, false, getter, setter);
  same(redefine(holder, { get: getter }), holder.target); redefine(holder, { set: setter }); same(read(holder), input);
  const changes: Change[] = [{ get: otherGetter }, { set: otherSetter }, { value: input }, { get: undefined }];
  for (const change of changes) { assert.throws(TypeError, () => redefine(holder, change)); same(read(holder), input); same(holder.target.raw, input); check(describe(holder), undefined, undefined, true, false, getter, setter); }
  write(holder, 23); same(read(holder), 23); same(holder.target.raw, 23); check(describe(holder), undefined, undefined, true, false, getter, setter);
  assert.compareArray(names(holder), ["raw", "p"]);
}
