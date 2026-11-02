/*---
description: A subclass instance seen as its base type can shadow inherited writable data but cannot shadow inherited non-writable data.
features: [ts-descriptor-route-writability, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-class, ts-class-fields, ts-declare-field, ts-inheritance, ts-interfaces, ts-record, ts-spread, ts-expressions, ts-strings]
---*/
// A base-class parameter carries a subclass with inherited data; node creates an ordinary own property only when the prototype descriptor permits assignment.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
class Base { declare value: number; }
class Child extends Base { kind: string = "child"; }
function makeTarget(value: number, writable: boolean): Base { Object.defineProperty(Base.prototype, "value", { value, writable, enumerable: false, configurable: true }); return new Child(); }
function write(target: Base, value: number): void { target.value = value; }
function read(target: Base): number { return target.value; }
function describe(target: Base): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(target, "value"); }
function inherited(target: Base): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object.getPrototypeOf(target)), "value"); }
function names(target: Base): string[] { return Object.getOwnPropertyNames(target); }
function keys(target: Base): string[] { return Object.keys(target); }
function has(target: Base): boolean { return "value" in target; }
for (const input of [-0, NaN, 17]) for (const writable of [false, true]) {
  const target: Base = makeTarget(input, writable); same(read(target), input); same(has(target), true); same(describe(target), undefined);
  check(inherited(target), input, writable, false, true); assert.compareArray(names(target), ["kind"]); assert.compareArray(keys(target), ["kind"]);
  if (writable) { write(target, 23); same(read(target), 23); check(describe(target), 23, true, true, true); }
  else { assert.throws(TypeError, () => write(target, 23)); same(read(target), input); same(describe(target), undefined); }
  check(inherited(target), input, writable, false, true); same(has(target), true);
  assert.compareArray(names(target), writable ? ["kind", "value"] : ["kind"]); assert.compareArray(keys(target), writable ? ["kind", "value"] : ["kind"]);
}
