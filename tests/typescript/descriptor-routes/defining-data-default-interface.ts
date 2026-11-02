/*---
description: An interface parameter creates data properties whose omitted attributes all default to false.
features: [ts-descriptor-route-defining, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-optional-properties, ts-null-undefined, ts-record, ts-spread]
---*/
// Optional interface data reaches defineProperty through a parameter; node creates hidden immutable nonconfigurable data and rejects writes and deletion.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Target { p?: number; }
function makeTarget(): Target { return {}; }
function install(target: Target, definition: { value?: number }): Target { return Object.defineProperty(target, "p", definition); }
function describe(target: Target): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(target, "p"); }
function read(target: Target): number | undefined { return target.p; }
function write(target: Target, value: number | undefined): void { target.p = value; }
function remove(target: Target): boolean { return delete target.p; }
function names(target: Target): string[] { return Object.getOwnPropertyNames(target); }
function keys(target: Target): string[] { return Object.keys(target); }
const definitions: { value?: number }[] = [{}, { value: undefined }, { value: -0 }, { value: NaN }, { value: 17 }];
for (const definition of definitions) {
  const target: Target = makeTarget(); assert.compareArray(names(target), []); same(describe(target), undefined);
  same(install(target, definition), target); check(describe(target), definition.value, false, false, false);
  same(read(target), definition.value); assert.compareArray(names(target), ["p"]); assert.compareArray(keys(target), []);
  assert.throws(TypeError, () => write(target, 23)); same(read(target), definition.value); check(describe(target), definition.value, false, false, false);
  assert.throws(TypeError, () => remove(target)); same(read(target), definition.value); assert.compareArray(names(target), ["p"]);
}
