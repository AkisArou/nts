/*---
description: A readonly interface aliases a mutable interface while runtime descriptor changes independently govern writes.
features: [ts-descriptor-route-writability, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-readonly, ts-record, ts-spread]
---*/
// A readonly interface value is assigned to a mutable interface alias; node permits writes until defineProperty makes the shared data property non-writable.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface ReadView { readonly value: number; }
interface WriteView { value: number; }
function makeTarget(value: number): ReadView { return { value }; }
function write(target: WriteView, value: number): void { target.value = value; }
function read(target: ReadView): number { return target.value; }
function lock(target: ReadView): ReadView { return Object.defineProperty(target, "value", { writable: false }); }
function describe(target: ReadView): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(target, "value"); }
function names(target: ReadView): string[] { return Object.getOwnPropertyNames(target); }
for (const input of [-0, NaN, 17]) {
  const view: ReadView = makeTarget(input), alias: WriteView = view;
  same(alias, view); check(describe(view), input, true, true, true); assert.compareArray(names(view), ["value"]);
  write(alias, 23); same(read(view), 23); check(describe(view), 23, true, true, true);
  same(lock(view), view); check(describe(view), 23, false, true, true);
  assert.throws(TypeError, () => write(alias, input)); same(read(view), 23); check(describe(view), 23, false, true, true);
  assert.throws(TypeError, () => write(alias, 23)); same(read(view), 23); check(describe(view), 23, false, true, true); assert.compareArray(names(alias), ["value"]);
}
