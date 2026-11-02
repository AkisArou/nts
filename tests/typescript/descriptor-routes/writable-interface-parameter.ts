/*---
description: An interface parameter enforces a data property writable flag for changed and identical assignments.
features: [ts-descriptor-route-writability, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-optional-properties, ts-null-undefined, ts-record, ts-spread]
---*/
// Optional interface data reaches writes through a parameter; node accepts writable data and throws even for an identical assignment when the runtime descriptor is non-writable.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Target { value?: number; }
function makeTarget(value: number | undefined, writable: boolean): Target { return Object.defineProperty({}, "value", { value, writable, enumerable: true, configurable: true }); }
function write(target: Target, value: number | undefined): void { target.value = value; }
function read(target: Target): number | undefined { return target.value; }
function describe(target: Target): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(target, "value"); }
function names(target: Target): string[] { return Object.getOwnPropertyNames(target); }
for (const input of [undefined, -0, NaN, 17]) for (const writable of [false, true]) {
  const target: Target = makeTarget(input, writable); check(describe(target), input, writable, true, true); assert.compareArray(names(target), ["value"]);
  if (writable) { write(target, input); same(read(target), input); write(target, 23); same(read(target), 23); }
  else {
    assert.throws(TypeError, () => write(target, input)); same(read(target), input); check(describe(target), input, false, true, true);
    assert.throws(TypeError, () => write(target, 23)); same(read(target), input); check(describe(target), input, false, true, true);
  }
  check(describe(target), writable ? 23 : input, writable, true, true); assert.compareArray(names(target), ["value"]);
}
